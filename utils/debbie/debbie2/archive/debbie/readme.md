# Debbie - a Debian bootstrapper and infra management solution

## What this
In 2020, I took my old asus laptop apart and installed Debian Linux - it was simpler and more barebones than Ubuntu.
It accumulated some tech debt, and I started adding more and more random gumf to it. For a while now it has been a workhorse web server for many of my sites. The number of sites grows, and so too does my laptop become a single-point-of-failure. That laptop bricks it, I'm scrambling for an infra rebuild.

Rather than rely on AWS "Free" tier, or vendor-locking myself to the cloud, I will instead make my whole setup reproducible on any hardware from the Seanorepo.

That means:

- Install Debian Linux onto any machine instantly with bootstrap install scripts
- Turn into a web server
  - Stop listening to device events e.g. lid close
  - Stay online always
  - Static IP on the local network
- Setup all the important utils: FTP, SSH, Git
- Autoserve
  - Watch the "Seanorepo" repo on Github. On push to main, server pulls the latest updates.
  - Automatic redeploy on local docker (?) instance

## Thank god for ChatGPT
You only learn when you choose to.
You can get GPT to write it all, or you can seriously interact with what it tells you.

Mostly I have a ChatGPT 4o window open and I'll be tabbing between. But I know what my goal is and I understand what it is doing at every step.

## Further reading
https://wiki.debian.org/ReproducibleInstalls
https://wiki.debian.org/DebianInstaller/Preseed
https://www.reddit.com/r/debian/comments/wdgu3t/pro_tip_you_can_automate_debian_installs_using_a/
https://github.com/debuerreotype/debuerreotype

https://chatgpt.com/c/67f79a9e-54bc-8011-948f-c4af391f8744
