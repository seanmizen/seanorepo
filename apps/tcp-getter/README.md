# ip-getter


provides one endpoint: `/send-ssh`. hit this to send an email with the current tcp tunnel address.
it's ephemeral, so it changes every time ngrok is restarted. this allows us to use our static url (thanks to cloudflare)

requires a running ngrok instance with a TCP tunnel. e.g.:
```bash
ngrok tcp 22
```

decided on this rather than a WARP client for SSH as setup was simpler, somehow.
