# Installing debbie on real hardware

The VM harness in [`../vm/`](../vm/) proves the preseed. This is how the same
preseed reaches a real machine.

**Target assumptions:** UEFI, wifi-only, and a disk you are happy to lose
entirely. Read [what the harness does not
prove](../README.md#what-it-does-not) before trusting a green VM run here.

## The shape of it

The preseed is fetched over the wifi from your laptop, so editing it between
attempts costs nothing and never touches the stick — the same property that
makes the VM loop usable.

The installer's kernel parameters are **baked into the ISO** by
[`build-iso.sh`](./build-iso.sh), so an install needs no keystrokes at all.
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
cd utils/debbie/2026-09-17/metal
brew install xorriso                   # once

# 1. the stock ISO
curl -fLO "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso"
curl -fsSL "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS" \
  | grep netinst | shasum -a 256 -c - | grep -v FAILED

# 2. configure
cp .env.example .env
openssl passwd -6                      # -> PASSWORD_CRYPTED
$EDITOR .env                           # + WIFI_SSID, WIFI_PASS, WIFI_IFACE, SERVER_NAME

# 3. bake the cmdline in
ISO=debian-13.7.0-amd64-netinst.iso ./build-iso.sh

# 4. write the stick ONCE - the built ISO, not the stock one
diskutil list                          # find it. dd takes the whole device.
diskutil unmountDisk force /dev/diskN
sudo dd if=work/debbie-$(grep ^SERVER_NAME .env | cut -d= -f2).iso of=/dev/rdiskN bs=4m

# 5. serve, then boot the target and walk away
./serve-preseed.sh

# 6. once it powers itself off, power it on and provision
./provision.sh
```

That is the whole thing. Steps 1-3 are needed once per preseed change; step 4
once per stick.

## 1. Configure and build

```bash
cp .env.example .env
openssl passwd -6                      # paste the hash into PASSWORD_CRYPTED
$EDITOR .env                           # + WIFI_SSID, WIFI_PASS, WIFI_IFACE
./build-iso.sh                         # ~3 seconds
```

`build-iso.sh` writes `work/debbie-<name>.iso` and verifies the result rather
than trusting the build: default entry present, preseed URL and wifi params
baked in *before* the `---`, El Torito catalogue intact.

**The built ISO contains your wifi passphrase in plaintext.** `work/` and
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
sudo dd if=work/debbie-<name>.iso of=/dev/rdisk4 bs=4m
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
./serve-preseed.sh
```

The script generates `overrides.cfg` with
[`../scripts/write-overrides.sh`](../scripts/write-overrides.sh) — the same
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
| `choose_interface=<iface>` | `auto` picks the first interface with a **carrier**, and wifi has none until it associates — so on a box with a dead ethernet port `auto` can pick the wrong one. Read it from the installer's shell (`Ctrl-Alt-F2`, `ip link`) if you don't know it. |

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
answerable without watching a console. Power the box back on, then:

```bash
./provision.sh
```

That waits for SSH, **asserts the box as the installer left it**, runs
`postinstall.sh`, reboots so the boot-time settings apply, waits for the box to
return, and asserts again — both times with the same `vm/assert.sh` the VM
runs, and with `EXPECT_HOSTNAME` and `DEPLOY_USER` taken from your `.env`. Exit
codes match the VM harness: `0` pass, `1` an assertion failed, `3` never came
up on SSH.

The **first** of those two runs is the one `#285` added, and it is the only one
that can catch a fault the installer creates and `postinstall.sh` repairs. The
first real install came up as hostname `192`; `postinstall.sh` corrected it, so
every check was green and nobody saw it for a generation. A first-boot failure
prints a loud banner, lets the repair proceed — being pointed at a broken box
is a legitimate reason to run this — and still exits non-zero at the end, so a
repaired box cannot be mistaken for a correctly installed one.

Since `#285` the box also answers to `$SERVER_NAME.local` on **first boot**:
`avahi-daemon` and `libnss-mdns` are installed by the preseed rather than by
`postinstall.sh`. Previously mDNS only started working after the step you had
to reach the box to run, which is why `HOST=<ip>` was so often needed below.

```bash
./provision.sh --assert       # assert only, box already provisioned
./provision.sh --no-reboot    # postinstall only
HOST=192.168.1.42 ./provision.sh   # if mDNS has not settled
```

Do not hand-run these steps with a hardcoded `debbie.local`: `assert.sh`
defaults to `EXPECT_HOSTNAME=debbie`, so with any other `SERVER_NAME` the
hostname check fails on a box that is actually correct. `provision.sh` passes
the right values, which is most of why it exists.

On metal the wifi assertion **runs** rather than skipping, so this is the first
place `REQ-SERVER-005` is genuinely tested.

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
   getting the box installed: doing it wrong leaves a headless machine with no
   network. See REQ-SERVER-005.
4. **UEFI drops the boot entry.** Why the preseed sets
   `force-efi-extra-removable`, and precisely what a VM cannot reproduce.
