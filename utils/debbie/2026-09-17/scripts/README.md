# Installing a target machine on real hardware

The VM harness in [`test-vm/`](./test-vm/) proves the preseed. This is how the same
preseed reaches a real machine.

**Target assumptions:** UEFI, wifi-only, and a disk you are happy to lose
entirely. Read [what the harness does not
prove](../README.md#what-a-vm-run-cannot-test) before you trust a green VM run here.

## Layout

```
scripts/1-build-iso/       build-iso.sh      .env.example   .env
scripts/2-serve-preseed/   serve-preseed.sh  .env.example   <machine>.env ...
scripts/3-provision/       provision.sh      .env.example   <machine>.env ...
scripts/lib.sh             shared by all three
working/                   shared output: the built ISO, VM runs (gitignored)
```

- Step 1 has one `.env`, because one USB stick installs every machine. Steps 2
  and 3 have one env file for each machine. `<machine>.env` and `.env` are
  gitignored.
- Each step reads ONLY the keys in its `.env.example`. A key from another step
  is an error that names the step it belongs to.
- In steps 2 and 3 the machine is a required argument:
  `./3-provision/provision.sh surface` reads `3-provision/surface.env`. With no
  argument, the step lists the machines that it has files for.
- Shared keys (`SERVER_NAME`, wifi) are repeated in each step on purpose. If
  they disagree, the first-boot hostname check in step 3 fails.

## The shape of it

The target fetches the preseed over the wifi from your computer. So an edit
between attempts costs nothing and never touches the stick. The VM loop is fast
for the same reason.

[`1-build-iso/build-iso.sh`](./1-build-iso/build-iso.sh) **bakes the installer's
kernel parameters into the ISO**, so an install needs no keystrokes. A boot line
typed at the GRUB menu is easy to get wrong in three ways:

- `Ctrl-X` must be pressed from inside the editor, or the edit is discarded.
- The wifi values cannot be dropped to shorten the line (see below).
- The parameters must go before the `---` separator.

The parameters are known in advance, so they belong in a file.

Only `boot/grub/grub.cfg` and `isolinux/txt.cfg` change, rebuilt with
`xorriso -boot_image any replay`. The preseed is **not** embedded in the
initrd, which would need a hand-written cpio archive. It comes over HTTP, so a
change to it needs no rebuild.

## Reproduce from zero

```bash
cd utils/debbie/2026-09-17/scripts
brew install xorriso                   # once

# 1. the stock ISO
curl -fLO "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso"
curl -fsSL "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS" \
  | grep netinst | shasum -a 256 -c - | grep -v FAILED

# 2. configure. Each .env.example says what goes in it.
cp 1-build-iso/.env.example 1-build-iso/.env        # wifi and the preseed server
MACHINE=<machine>
for s in 2-serve-preseed 3-provision; do cp $s/.env.example $s/$MACHINE.env; done
openssl passwd -6                      # -> PASSWORD_CRYPTED in 2-serve-preseed
$EDITOR 1-build-iso/.env */$MACHINE.env    # SERVER_NAME in 2 and 3. ROLE_* in 3 if it serves.

# 3. bake the boot line in
ISO=debian-13.7.0-amd64-netinst.iso ./1-build-iso/build-iso.sh

# 4. write the stick - the built ISO, not the stock one
diskutil list                          # find it. dd takes the whole device.
diskutil unmountDisk force /dev/diskN
sudo dd if=../working/debbie-installer.iso of=/dev/rdiskN bs=4m

# 5. serve, then boot the target and walk away
./2-serve-preseed/serve-preseed.sh $MACHINE

# 6. when it powers itself off, power it on and provision
./3-provision/provision.sh $MACHINE

# 7. after provisioning - see "After provisioning" below
```

That is the whole procedure. Steps 1 to 4 make one stick for every machine.
Do them again only when the wifi or the address of the preseed server changes.
Steps 5 and 6 run once for each machine.

## 1. Configure and build

```bash
cp 1-build-iso/.env.example 1-build-iso/.env
$EDITOR 1-build-iso/.env               # WIFI_*, and SERVE_IP if autodetect fails
./1-build-iso/build-iso.sh             # ~3 seconds
```

`build-iso.sh` writes `working/debbie-installer.iso` and checks the result, not
the build: the default entry is present, the preseed URL and wifi params are
*before* the `---`, and the El Torito catalogue is intact.

**The built ISO contains your wifi passphrase in plaintext.** `working/` and
`*.iso` are gitignored. Treat the stick as a credential.

## 2. Write the stick

The **official** netinst image of Debian 12 and later includes non-free
firmware, so there is no separate firmware image to find. That matters most
here: a wifi chipset with no firmware means that `netcfg` cannot associate, and
a preseeded install with no network hangs forever, with nothing on screen that
says why.

Verify the download before you write it, always.

**Write the ISO that `build-iso.sh` produced, not the stock one.** That is the
purpose of step 1.

```bash
diskutil list                          # identify the stick, e.g. disk4
diskutil unmountDisk force /dev/disk4
sudo dd if=../working/debbie-installer.iso of=/dev/rdisk4 bs=4m
```

`force` is necessary in practice. Spotlight's `mds_stores` indexes a newly
written stick and refuses the unmount. The plain form then fails with "Unmount
was dissented by PID ... mds_stores", which looks like a hardware fault.

`rdisk4`, not `disk4`: the raw device is about 10x faster. macOS `dd` has no
`status=progress`. Press **Ctrl-T** for a progress line. The Debian ISO is
isohybrid, so a plain `dd` boots under both UEFI and BIOS with no partitioning
work.

## 3. Serve and boot

```bash
cp 2-serve-preseed/.env.example 2-serve-preseed/<machine>.env
openssl passwd -6                      # paste the hash into PASSWORD_CRYPTED
$EDITOR 2-serve-preseed/<machine>.env  # SERVER_NAME, and the same wifi as step 1
./2-serve-preseed/serve-preseed.sh <machine>
```

The script makes `overrides.cfg` with `write_overrides` in [`lib.sh`](./lib.sh),
the same generator that the VM harness uses. So a real install and a proven
install cannot drift. It then serves the directory, **checks that the URL is
reachable on the LAN address, not only on loopback**, and prints the boot line
for the manual fallback. Without that check, a macOS firewall prompt that
nobody clicked shows up halfway through an install, as a hang.

Both machines must be on the same wifi network, and your computer must stay
awake for the whole install (`caffeinate -i` in another terminal).

Now boot the stick. **Nothing to type:** the automated entry is the default and
boots after five seconds. The stock menu entries are there for a manual
install.

This was checked in QEMU under OVMF: the remastered ISO boots on its own, skips
language and keyboard, fetches the preseed over HTTP, and reaches partitioning
with zero prompts.

### Fallback: typing the boot line by hand

Only for a stock ISO. Highlight **Install**, press `e` (UEFI GRUB) or `TAB`
(BIOS isolinux), and insert the params **before the `---`**.
`serve-preseed.sh` prints the exact string.

These are checked against trixie's `netcfg` 1.197 templates, because all three
are easy to get wrong from memory:

| Key | Why it is like that |
|---|---|
| `wireless_security_type=wpa` | The values of the select are `wep/open` and `wpa`. There is no `wpa2`: `wpa` covers WPA2 PSK. |
| `wireless_show_essids=manual` | A *separate* prompt from `wireless_essid`, which offers a scanned list. Without it, the installer stops and asks, even with the ESSID preset. |
| `choose_interface=<iface>` | `auto` picks the first interface with a **carrier**, and wifi has none until it associates. So on a machine with a dead ethernet port, `auto` can pick the wrong one. Read it from the installer's shell (`Ctrl-Alt-F2`, `ip link`) if you do not know it. |

**The wifi values are mandatory, not a convenience.** `priority=critical`
suppresses the prompt that would ask for them. So a missing passphrase becomes
an *empty* one, and netcfg rejects it with "either too long (more than 64
characters) or too short (less than 8 characters)", a message that blames a
password you never typed. You cannot drop them to shorten the line.
`build-iso.sh` checks the length of `WIFI_PASS` first, so the baked route
cannot reach this failure.

`Ctrl-X` is also necessary: it is the only key that boots the edited line.
`Esc` or `Enter` discards the edit with no message, and the result looks the
same as parameters that do not work. If the installer asks for a language,
that is what happened. `cat /proc/cmdline` on `Ctrl-Alt-F2` confirms it.

## 4. Provision

The preseed ends in **poweroff**, not reboot, so you can tell that the install
finished without watching a console. Power the machine on, then:

```bash
cp 3-provision/.env.example 3-provision/<machine>.env
$EDITOR 3-provision/<machine>.env      # same SERVER_NAME. ROLE_* only if it serves.
./3-provision/provision.sh <machine>
```

`provision.sh` then does these steps:

1. It waits for SSH.
2. It **asserts the machine as the installer left it**.
3. It runs `setup-developer-environment.sh`, then `setup-server-environment.sh`.
4. It reboots, so that the boot-time settings apply, and waits for the machine.
5. It asserts again.

Both assertions use the same `payload/assert.sh` as the VM, with
`EXPECT_HOSTNAME` and `DEPLOY_USER` from `3-provision/<machine>.env`. The exit
codes match the VM harness: `0` pass, `1` an assertion failed, `3` the machine
did not come back on SSH.

The **first** assertion is the only one that can catch a fault that the
installer makes and `setup-server-environment.sh` repairs. An example: a
machine that installs as hostname `192`. `setup-server-environment.sh` corrects
the name, so every later check is green, and nobody sees the fault. A
first-boot failure prints a loud banner and lets the repair continue, because a
run against a broken machine is a valid use. The run still exits non-zero at
the end, so a repaired machine cannot pass for a correctly installed one.

The machine answers to `$SERVER_NAME.local` on the **first boot**, because the
preseed installs `avahi-daemon` and `libnss-mdns`. So you rarely need
`HOST=<ip>` (below).

```bash
./3-provision/provision.sh <machine> --assert       # assert only, machine already provisioned
./3-provision/provision.sh <machine> --no-reboot    # configure only, no reboot
HOST=192.168.1.42 ./3-provision/provision.sh <machine>   # fallback, if .local does not reach the machine
```

### The reboot has to be proved, not assumed

A **new boot id** satisfies the wait after the reboot, not a live SSH socket.
`provision.sh` reads `/proc/sys/kernel/random/boot_id` before it asks the
machine to reboot. It treats the machine as back only when something answers
with a *different* one.

A fixed sleep and a poll are not enough. A clean shutdown with Docker
containers to stop can take longer than the sleep. The first poll then reaches
the system **before the reboot**, and the `provisioned` assertions run against
a machine that did not reboot. The checks that fail are exactly the ones the
reboot exists for, `lid close ignored` and `sleep.target masked`
(REQ-SERVER-001). The result is a false red on a machine that is fine, and a
second run appears to fix it.

The check uses the boot id and never the host, because the machine can come
back on a different address. Two addresses that report the same boot id are
one machine that did not reboot. An address that reports a new one is a
machine that did.

A machine that does not come back exits `3` within `SSH_WAIT`, and the message
says which failure it was:

- *nothing answered*: look at the lease table and mDNS, below.
- *answered, but never rebooted*: something blocks the shutdown. Try
  `journalctl -b -u docker`, or increase `SSH_WAIT` if the machine is only
  slow.

### It dials the name, and `HOST` is only a fallback

`provision.sh` connects to **`$SERVER_NAME.local`** and falls back to `HOST`
only if the name does not answer. The reason is the reboot in the middle of
the run: **the DHCP lease can move on every boot.** A pinned address from
before the reboot can be wrong after it, and a run would then time out against
a machine that is up on a different address.

So:

- **Prefer no `HOST` at all.** The name works from the first boot, and it is
  the only handle that survives the reboot.
- Set `HOST=<ip>` only if `.local` does not reach the machine from your
  computer: a network with wifi client isolation, or the two machines on
  different subnets. Check with `ping -c1 $SERVER_NAME.local` first.
- Either way, the address is **tried within seconds**, not after the 300s
  timeout: each polling round tries the name and then the address.
- Nothing is pinned. Both waits (the one before `setup-server-environment.sh`
  and the one after the reboot) choose again from the same list, so a machine
  that comes back on a new lease is found by name. The log says which one
  answered (`up on <machine>.local`).

`./3-provision/provision.sh <machine> --assert` works the same way, so an
assert of a provisioned machine needs no address either.

If neither answers, the error names both and says what to do about each. An
address from this runbook or from your shell history can be wrong after any
boot, so read the address from the router's lease table.

A **DHCP reservation** for this host would stop the lease from moving, and it is
worth doing. Nothing here may depend on it: it is router configuration that no
script can assert or reproduce. So mDNS stays the mechanism, and a reservation
is only a convenience.

Do not run these steps by hand against a hardcoded `.local` name. `assert.sh`
requires `EXPECT_HOSTNAME`, and a wrong value fails the hostname check on a
machine that is correct. `provision.sh` passes the correct values, which is
most of why it exists.

On hardware the wifi assertion **runs** and does not skip, so this is the one
place that tests `REQ-SERVER-005`.

## After provisioning

`provision.sh` ends with the machine's roles (`roles on <name>: webserver=… tunnel=…`).
With no `ROLE_*` in `3-provision/<machine>.env`, the machine tracks `release`
and runs nothing. That is the safe state, and the correct one for a machine
during setup. The rest is by hand, because each piece is a credential that is
in no repository:

| Step | Which machines | How |
|---|---|---|
| **ngrok token** - SSH from outside the LAN | every machine | as `srv` on the machine: `ngrok config add-authtoken <token>`, then run `./3-provision/provision.sh <machine>` again. Find the address: [Remote SSH](../README.md#remote-ssh-ngrok) |
| **Serve the sites** | webservers | set `ROLE_WEBSERVER=yes` in `3-provision/<machine>.env`, and run `./3-provision/provision.sh <machine>` again. Without the tunnel role, the sites are published on the LAN |
| **Tunnel credentials** - the internet reaches this machine | the ONE tunnel machine | Set `ROLE_TUNNEL=yes` too. Copy the credentials JSON into `apps/cloudflared/credentials/` on the machine ([recipe](../README.md#set-up-the-cloudflare-tunnel)). Run `./3-provision/provision.sh <machine>` again |

**Moving the public sites to another machine** is a deliberate act, because the
data moves with them (SQLite on local volumes):

1. Remove `ROLE_TUNNEL` from the old machine's `3-provision/<machine>.env`, and
   provision it again. Its tunnel stops.
2. Copy the data and the credentials across.
3. Set both roles on the new machine, and provision it.

Never give the tunnel role to two machines at once.

Check any machine: `ssh srv@<name>.local ls /etc/seanorepo/roles`.

## Where this is likely to go wrong

In rough order of probability, and the VM loop shows none of them:

1. **`netcfg` cannot associate.** A wrong passphrase, or firmware that the
   netinst does not have. The installer's fourth console (`Ctrl-Alt-F4`) shows
   the syslog. `Ctrl-Alt-F2` gives a shell with `ip link` and `dmesg`.
2. **The disk filter picks the wrong disk.** `preseed.cfg`'s `early_command`
   skips devices whose `/sys/block/*/removable` is `1`. USB flash sticks report
   `1`. Some USB **SSDs** report `0` and are installation candidates. Look once
   from the installer shell before you continue.
3. **Wifi does not survive the reboot.** `netcfg` writes a
   `wpa-ssid`/`wpa-psk` stanza into `/etc/network/interfaces` and installs
   `wpasupplicant` in the target. That is ifupdown, not NetworkManager, and it
   is what this generation ships. The failover watchdog uses `ip` only, so it
   works with ifupdown. A move to NetworkManager is deliberately **not** part
   of the install: a mistake there leaves a headless machine with no network.
   See REQ-SERVER-005.
4. **UEFI drops the boot entry.** That is why the preseed sets
   `force-efi-extra-removable`, and a VM cannot reproduce it.
