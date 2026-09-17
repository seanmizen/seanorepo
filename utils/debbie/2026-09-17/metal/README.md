# Installing debbie on real hardware

The VM harness in [`../vm/`](../vm/) proves the preseed. This is how the same
preseed reaches a real machine.

**Target assumptions:** UEFI, wifi-only, and a disk you are happy to lose
entirely. Read [what the harness does not
prove](../README.md#what-it-does-not) before trusting a green VM run here.

## The shape of it

No ISO remaster, no embedded preseed, no build step. The stick is an unmodified
Debian netinst image; the preseed is fetched over the wifi from your laptop, by
a URL you type at the boot menu. Editing the preseed between attempts costs
nothing and never touches the stick — the same property that makes the VM loop
usable.

## 1. Write the stick

Since Debian 12 the **official** netinst image includes non-free firmware, so
there is no separate firmware ISO to hunt for (the old
`images-including-firmware/` path 404s for trixie). This matters more here than
anywhere else: a wifi chipset with no firmware means `netcfg` cannot associate,
and a preseeded install with no network hangs forever with nothing on screen
explaining why.

```bash
ISO=debian-13.7.0-amd64-netinst.iso
curl -fLO "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$ISO"
curl -fsSL "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS" \
  | grep "$ISO" | shasum -a 256 -c -
```

Verify before writing, always. Then find the stick and write it — **`dd` to the
wrong disk takes the whole disk with it, so read the `diskutil list` output
rather than assuming the number:**

```bash
diskutil list                          # identify the stick, e.g. disk4
diskutil unmountDisk /dev/disk4
sudo dd if="$ISO" of=/dev/rdisk4 bs=4m # rdisk4, not disk4 - raw is ~10x faster
```

macOS `dd` has no `status=progress`; press **Ctrl-T** for a progress line. The
Debian ISO is isohybrid, so a plain `dd` boots under both UEFI and BIOS with no
partitioning work.

## 2. Configure and serve

```bash
cp .env.example .env
openssl passwd -6                      # paste the hash into PASSWORD_CRYPTED
$EDITOR .env                           # + WIFI_SSID, WIFI_PASS
./serve-preseed.sh
```

The script generates `overrides.cfg` with
[`../scripts/write-overrides.sh`](../scripts/write-overrides.sh) — the same
generator the VM harness uses, which is the point: a real install and a proven
install cannot drift. It then serves the directory, **checks the URL is
reachable on the LAN address rather than only on loopback** (a macOS firewall
prompt nobody clicked is otherwise discovered halfway through an install, as a
hang), and prints the boot line with your values filled in.

Both machines must be on the same wifi network.

## 3. Boot the target

At the installer menu, highlight **Install**, press `e` (UEFI GRUB) or `TAB`
(BIOS isolinux) to edit the kernel line, and append what the script printed:

```
auto=true priority=critical url=http://<laptop-ip>:8000/preseed.cfg \
  netcfg/choose_interface=<wlan iface> \
  netcfg/wireless_show_essids=manual \
  netcfg/wireless_essid=<SSID> \
  netcfg/wireless_security_type=wpa \
  netcfg/wireless_wpa=<passphrase>
```

Verified against trixie's `netcfg` 1.197 templates, because all three of these
are easy to get wrong from memory:

| Key | Why it is like that |
|---|---|
| `wireless_security_type=wpa` | The select's values are `wep/open` and `wpa`. There is no `wpa2` — `wpa` covers WPA2 PSK. |
| `wireless_show_essids=manual` | A *separate* prompt from `wireless_essid`, offering a scanned list. Unset, the installer stops and asks even though the ESSID is preset. |
| `choose_interface=<iface>` | `auto` picks the first interface with a **carrier**, and wifi has none until it associates — so on a box with a dead ethernet port `auto` can pick the wrong one. If you don't know the name, omit it and pick from the prompt, or read it from the installer's shell (`Ctrl-Alt-F2`, `ip link`). |

The passphrase stays on the boot line and never enters the repository.

## 4. Provision

The preseed ends in **poweroff**, not reboot, so "did the install finish?" is
answerable without watching a console. Power the box back on:

```bash
ssh -i work/id_ed25519 srv@debbie.local
curl -fsSL http://<laptop-ip>:8000/postinstall.sh | sudo bash
sudo reboot                            # REQ-SERVER-001 applies at next boot
```

Then run the assertions against the real box, which is the only place some of
them have ever run:

```bash
ssh -i work/id_ed25519 srv@debbie.local 'bash -s' < ../vm/assert.sh
```

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
