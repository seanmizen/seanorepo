# Debbie-PXE
This is another attempt.

serve.sh: this starts a PXE server from this device.
A PXE server advertises on LAN to any device trying to "network boot": "I am available to serve you"

So if you want to automate network installs of devices, run a PXE server.

This particular serve.sh serves "Debbie", a debian installation media with additional setup scripts to turn a x86_64 laptop into a home server.
Computers with this setup are called "Debbie" also.

It must be
1. SSH-ready using a pre-configured Cloudflare tunnel.
2. A Deployment server.
3. A web server. Larger sites can be weened off onto AWS etc, as necessary.

## Usage
1. Get iPXE binary:
   ```bash
   wget https://boot.ipxe.org/undionly.kpxe -O bin/undionly.kpxe
   ```
2. Extract vmlinuz/initrd.gz from ISO (in /install.amd/)
3. Place your preseed.cfg in ipxe/

4. Run: ./serve.sh

5. Boot target machine via PXE — it gets iPXE, loads boot.ipxe, and installs Debian.

Make sure eth0 is the right LAN interface.
