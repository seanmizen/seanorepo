# Installing debbie on real hardware

The VM harness in [`test-vm/`](./test-vm/) proves the preseed. This is how the same
preseed reaches a real machine.

**Target assumptions:** UEFI, wifi-only, and a disk you are happy to lose
entirely. Read [what the harness does not
prove](../README.md#what-a-vm-run-cannot-test) before trusting a green VM run here.

## Layout

```
scripts/1-build-iso/       build-iso.sh      .env.example   <machine>.env ...
scripts/2-serve-preseed/   serve-preseed.sh  .env.example   <machine>.env ...
scripts/3-provision/       provision.sh      .env.example   <machine>.env ...
scripts/lib.sh             shared by all three
working/                   shared output: built ISOs, the SSH key (gitignored)
```

- One env file per step, per machine. `<machine>.env` and `.env` are gitignored.
- Each step reads ONLY the keys in its `.env.example`. A key from another step
  is an error that names the step it belongs to.
- The machine is a required argument: `./3-provision/provision.sh trixie2` reads
  `3-provision/trixie2.env`. No argument lists the machines that step has files for.
- Shared keys (`SERVER_NAME`, wifi) are repeated per step on purpose. If they
  disagree, the first-boot hostname check in step 3 fails.

## The shape of it

The preseed is fetched over the wifi from your laptop, so editing it between
attempts costs nothing and never touches the stick — the same property that
makes the VM loop usable.

The installer's kernel parameters are **baked into the ISO** by
[`1-build-iso/build-iso.sh`](./1-build-iso/build-iso.sh), so an install needs no keystrokes at all.
They used to be typed at the GRUB menu, which failed three times running on
first contact with real hardware: an edit discarded because `Ctrl-X` was not
pressed from inside the editor, the wifi presets dropped to shorten the line
(which cannot work — see below), and the standing risk of landing them after
the `---` separator. The parameters are known in advance; they belong in a
file, not in muscle memory.

Only `boot/grub/grub.cfg` and `isolinux/txt.cfg` change, rebuilt with
`xorriso -boot_image any replay`. This is **not** the initrd-embedded preseed
that killed the December 2025 attempt — that needed a hand-written cpio
archive. The preseed still comes over HTTP, so changing it needs no rebuild.

## Reproduce from zero

```bash
cd utils/debbie/2026-09-17/scripts
brew install xorriso                   # once

# 1. the stock ISO
curl -fLO "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso"
curl -fsSL "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS" \
  | grep netinst | shasum -a 256 -c - | grep -v FAILED

# 2. configure - one env file per step, per machine. Each .env.example says what.
MACHINE=trixie2
for s in 1-build-iso 2-serve-preseed 3-provision; do cp $s/.env.example $s/$MACHINE.env; done
openssl passwd -6                      # -> PASSWORD_CRYPTED in 2-serve-preseed
$EDITOR */$MACHINE.env                     # SERVER_NAME in all three; ROLE_* in 3 if it serves

# 3. bake the cmdline in
ISO=debian-13.7.0-amd64-netinst.iso ./1-build-iso/build-iso.sh $MACHINE

# 4. write the stick ONCE - the built ISO, not the stock one
diskutil list                          # find it. dd takes the whole device.
diskutil unmountDisk force /dev/diskN
sudo dd if=../working/debbie-$(grep ^SERVER_NAME 1-build-iso/$MACHINE.env | cut -d= -f2).iso of=/dev/rdiskN bs=4m

# 5. serve, then boot the target and walk away
./2-serve-preseed/serve-preseed.sh $MACHINE

# 6. once it powers itself off, power it on and provision
./3-provision/provision.sh $MACHINE

# 7. after provisioning - see "After provisioning" below
```

That is the whole thing. Steps 1-3 are needed once per preseed change; step 4
once per stick.

## 1. Configure and build

```bash
cp 1-build-iso/.env.example 1-build-iso/trixie2.env
$EDITOR 1-build-iso/trixie2.env        # SERVER_NAME, WIFI_*
./1-build-iso/build-iso.sh trixie2     # ~3 seconds
```

`build-iso.sh` writes `working/debbie-<name>.iso` and verifies the result rather
than trusting the build: default entry present, preseed URL and wifi params
baked in *before* the `---`, El Torito catalogue intact.

**The built ISO contains your wifi passphrase in plaintext.** `working/` and
`*.iso` are gitignored; treat the stick as a credential.

## 2. Write the stick

Since Debian 12 the **official** netinst image includes non-free firmware, so
there is no separate firmware ISO to hunt for (the old
`images-including-firmware/` path 404s for trixie). This matters more here than
anywhere else: a wifi chipset with no firmware means `netcfg` cannot associate,
and a preseeded install with no network hangs forever with nothing on screen
explaining why.

Verify the download before writing, always.

**Write the ISO that `build-iso.sh` produced, not the stock one** — that is the
whole point of step 3, and writing the stick before building it is a wasted
`dd`.

```bash
diskutil list                          # identify the stick, e.g. disk4
diskutil unmountDisk force /dev/disk4
sudo dd if=../working/debbie-<name>.iso of=/dev/rdisk4 bs=4m
```

`force` is not optional in practice: Spotlight's `mds_stores` indexes a
freshly-written stick and dissents the unmount, and the plain form then fails
with "Unmount was dissented by PID ... mds_stores", which reads like a hardware
fault.

`rdisk4`, not `disk4` — the raw device is roughly 10x faster. macOS `dd` has no
`status=progress`; press **Ctrl-T** for a progress line. The Debian ISO is
isohybrid, so a plain `dd` boots under both UEFI and BIOS with no partitioning
work.

## 3. Serve and boot

```bash
cp 2-serve-preseed/.env.example 2-serve-preseed/trixie2.env
openssl passwd -6                      # paste the hash into PASSWORD_CRYPTED
$EDITOR 2-serve-preseed/trixie2.env    # same SERVER_NAME and wifi as step 1
./2-serve-preseed/serve-preseed.sh trixie2
```

The script generates `overrides.cfg` with
`write_overrides` in [`lib.sh`](./lib.sh) — the same
generator the VM harness uses, which is the point: a real install and a proven
install cannot drift. It then serves the directory, **checks the URL is
reachable on the LAN address rather than only on loopback** (a macOS firewall
prompt nobody clicked is otherwise discovered halfway through an install, as a
hang), and prints the boot line for the manual fallback.

Both machines must be on the same wifi network, and the Mac must stay awake
across the whole install (`caffeinate -i` in another terminal).

Now boot the stick. **Nothing to type** — the automated entry is the default
and boots after five seconds. The stock menu entries are still there if you
want a manual install.

Verified in QEMU under OVMF before ever reaching hardware: the remastered ISO
auto-boots, skips language and keyboard entirely, fetches the preseed over HTTP
and reaches partitioning with zero prompts.

### Fallback: typing the boot line by hand

Only needed if you are booting a stock ISO. Highlight **Install**, press `e`
(UEFI GRUB) or `TAB` (BIOS isolinux), and insert the params **before the
`---`**. `serve-preseed.sh` prints the exact string.

Verified against trixie's `netcfg` 1.197 templates, because all three are easy
to get wrong from memory:

| Key | Why it is like that |
|---|---|
| `wireless_security_type=wpa` | The select's values are `wep/open` and `wpa`. There is no `wpa2` — `wpa` covers WPA2 PSK. |
| `wireless_show_essids=manual` | A *separate* prompt from `wireless_essid`, offering a scanned list. Unset, the installer stops and asks even though the ESSID is preset. |
| `choose_interface=<iface>` | `auto` picks the first interface with a **carrier**, and wifi has none until it associates — so on a machine with a dead ethernet port `auto` can pick the wrong one. Read it from the installer's shell (`Ctrl-Alt-F2`, `ip link`) if you don't know it. |

**The wifi values are mandatory, not a convenience.** `priority=critical`
suppresses the prompt that would otherwise ask for them, so a missing
passphrase becomes an *empty* one, and netcfg rejects it with "either too long
(more than 64 characters) or too short (less than 8 characters)" — a message
that blames a password you never typed. Dropping them to shorten the line is
the one shortcut that cannot work. `build-iso.sh` length-checks `WIFI_PASS`
up front so this is unreachable on the baked route.

`Ctrl-X` is also load-bearing: it is the only key that boots the edited line.
`Esc` or `Enter` discards the edit silently, and the result is
indistinguishable from the parameters never having worked. If the installer
asks for a language, that is what happened — `cat /proc/cmdline` on
`Ctrl-Alt-F2` confirms it.

## 4. Provision

The preseed ends in **poweroff**, not reboot, so "did the install finish?" is
answerable without watching a console. Power the machine back on, then:

```bash
cp 3-provision/.env.example 3-provision/trixie2.env
$EDITOR 3-provision/trixie2.env        # same SERVER_NAME; ROLE_* only if it serves
./3-provision/provision.sh trixie2
```

That waits for SSH, **asserts the machine as the installer left it**, runs
`setup-developer-environment.sh` and then `setup-server-environment.sh`, reboots
so the boot-time settings apply, waits for the machine to
return, and asserts again — both times with the same `payload/assert.sh` the VM
runs, and with `EXPECT_HOSTNAME` and `DEPLOY_USER` taken from `3-provision/<machine>.env`. Exit
codes match the VM harness: `0` pass, `1` an assertion failed, `3` never came
back on SSH.

The **first** of those two runs is the one `#285` added, and it is the only one
that can catch a fault the installer creates and `setup-server-environment.sh` repairs. The
first real install came up as hostname `192`; `setup-server-environment.sh` corrected it, so
every check was green and nobody saw it for a generation. A first-boot failure
prints a loud banner, lets the repair proceed — being pointed at a broken machine
is a legitimate reason to run this — and still exits non-zero at the end, so a
repaired machine cannot be mistaken for a correctly installed one.

Since `#285` the machine also answers to `$SERVER_NAME.local` on **first boot**:
`avahi-daemon` and `libnss-mdns` are installed by the preseed rather than by
`setup-server-environment.sh`. Previously mDNS only started working after the step you had
to reach the machine to run, which is why `HOST=<ip>` was so often needed below.

```bash
./3-provision/provision.sh trixie2 --assert       # assert only, machine already provisioned
./3-provision/provision.sh trixie2 --no-reboot    # configure only, no reboot
HOST=192.168.1.42 ./3-provision/provision.sh trixie2   # fallback, if .local does not reach the machine
```

### The reboot has to be proved, not assumed

The wait after the reboot is satisfied by a **new boot id**, not by a live SSH
socket — `#295`. `provision.sh` reads
`/proc/sys/kernel/random/boot_id` before asking the machine to reboot, and treats
it as back only once something answers with a *different* one.

It used to send `systemctl reboot`, sleep 10s and poll. A clean shutdown with
Docker containers to stop takes longer than that, so the first poll could reach
the **pre-reboot** system, and the `provisioned` assertions then ran against a
machine that had not rebooted. The checks that fail in that case are exactly the
ones the reboot exists for — `lid close ignored` and `sleep.target masked`
(REQ-SERVER-001) — so the symptom was a spurious red on a machine that was fine,
and the fix everyone reached for was re-running, which passed.

The check is keyed on the boot id and never on the host, which is what lets it
sit on top of `#284`: the machine may legitimately come back on a different address
than the one it left on. Two addresses reporting the same boot id is one
machine that never rebooted; either address reporting a new one is a machine that
did.

A machine that never comes back still exits `3` within `SSH_WAIT`, and the message
says which failure it was — *nothing answered* (look at the lease table and
mDNS, below) versus *answered, but never rebooted* (something is blocking
shutdown; try `journalctl -b -u docker`, or raise `SSH_WAIT` if it is merely
slow).

### It dials the name, and `HOST` is only a fallback

`provision.sh` connects by **`$SERVER_NAME.local`** and falls back to `HOST`
only if the name does not answer. That ordering is the fix for `#284`, and it is
about the reboot in the middle of the run: **the DHCP lease moves on every
boot.** The first real machine took `.182`, then `.183`, then `.184`, one per power
cycle. A run started with `HOST=192.168.1.182` used to keep dialling `.182`
after the reboot and time out against a machine that was up the whole time, on a
different address:

```
[metal] waiting for srv@192.168.1.182
ERROR: 192.168.1.182 did not come up on SSH within 300s.
```

So:

- **Prefer no `HOST` at all.** Since `#285` the name works from first boot, and
  it is the only handle that survives the reboot.
- Set `HOST=<ip>` only if `.local` does not reach the machine from your laptop — a
  network with wifi client isolation, or the two machines on different subnets.
  Check with `ping -c1 $SERVER_NAME.local` before assuming it.
- Either way the address is **tried within seconds**, not after the 300s
  timeout: each polling round tries the name and then the address.
- Nothing is pinned. Both waits — the one before `setup-server-environment.sh` and the one
  after the reboot — re-choose from the same list, so a machine that came back on a
  new lease is still found by name. The log says which one answered (`up on
  debbie.local`).

`./3-provision/provision.sh <machine> --assert` works the same way, so asserting an
already-provisioned machine needs no address either.

If neither answers, the error names both and says what to do about each; the
addresses in this runbook and in your shell history go stale on every boot, so
read the current one off the router's lease table rather than an earlier run.

A **DHCP reservation** for this host would stop the lease moving, and is worth
doing. Nothing here may depend on it: it is router-side configuration that no
script can assert or reproduce, so mDNS stays the mechanism and a reservation
is only a convenience on top.

Do not hand-run these steps with a hardcoded `debbie.local`: `assert.sh`
defaults to `EXPECT_HOSTNAME=debbie`, so with any other `SERVER_NAME` the
hostname check fails on a machine that is actually correct. `provision.sh` passes
the right values, which is most of why it exists.

On metal the wifi assertion **runs** rather than skipping, so this is the first
place `REQ-SERVER-005` is genuinely tested.

## After provisioning

`provision.sh` ends with the machine's roles (`roles on <name>: webserver=… tunnel=…`).
With no `ROLE_*` in `3-provision/<machine>.env` the machine tracks `release` and runs nothing — the
safe state, and the right one for a machine being set up. What is left is by hand,
because each piece is a credential that is in no repository:

| Step | Which machines | How |
|---|---|---|
| **ngrok token** — SSH from off the LAN | every machine | as `srv` on the machine: `ngrok config add-authtoken <token>`, then re-run `./3-provision/provision.sh <machine>`. Find the address: [Remote SSH](../README.md#remote-ssh-ngrok) |
| **Serve the sites** | webservers | set `ROLE_WEBSERVER=yes` in `3-provision/<machine>.env`, re-run `./3-provision/provision.sh <machine>`. Without the tunnel role they are published on the LAN |
| **Tunnel credentials** — the internet reaches this machine | the ONE tunnel machine | set `ROLE_TUNNEL=yes` too, copy the credentials JSON into `apps/cloudflared/credentials/` on the machine ([recipe](../README.md#set-up-the-cloudflare-tunnel)), re-run `./3-provision/provision.sh <machine>` |

**Moving the public sites to another machine** is a deliberate act, because the
data moves with it (SQLite on local volumes): take `ROLE_TUNNEL` off the old
machine's `3-provision/<machine>.env` and re-provision it (its tunnel stops), copy the data and the
credentials across, then set both roles on the new machine and provision it. Never
have the tunnel role on two machines at once.

Check any machine: `ssh srv@<name>.local ls /etc/seanorepo/roles`.

## Where this is likely to go wrong

In rough order of probability, and all of them invisible to the VM loop:

1. **`netcfg` cannot associate.** Wrong passphrase, or firmware the netinst
   does not carry. The installer's fourth console (`Ctrl-Alt-F4`) shows the
   syslog; `Ctrl-Alt-F2` gives a shell with `ip link` and `dmesg`.
2. **The disk filter picks the wrong disk.** `preseed.cfg`'s `early_command`
   skips devices whose `/sys/block/*/removable` is `1`. USB flash sticks report
   `1`; some USB **SSDs** report `0` and would be installation candidates.
   Worth one look from the installer shell before you commit.
3. **Wifi does not survive the reboot.** `netcfg` writes a
   `wpa-ssid`/`wpa-psk` stanza into `/etc/network/interfaces` and installs
   `wpasupplicant` in the target, which is ifupdown, not NetworkManager. That
   works, and it is what this generation ships — but production debbie's
   `net-failover.sh` drives wifi through `nmcli` and will not see an
   ifupdown-managed interface. Migrating is deliberately **not** coupled to
   getting the machine installed: doing it wrong leaves a headless machine with no
   network. See REQ-SERVER-005.
4. **UEFI drops the boot entry.** Why the preseed sets
   `force-efi-extra-removable`, and precisely what a VM cannot reproduce.
