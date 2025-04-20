DO NOT CHANGE THE NAME OF THE SEANOREPO, UTILS, OR CONFIG-ANYWHERE. THIS IS WHERE WE STORE RAW.GITHUB LINKS
AND HOST VARIOUS TOOLS AND SUCH THINGS

e.g. 
```bash
curl https://raw.githubusercontent.com/seanmizen/seanorepo/main/utils/config-anywhere/gitconfig.txt
```

nasty one-liner to feed this to your git config:
```bash
curl -s https://raw.githubusercontent.com/seanmizen/seanorepo/main/utils/config-anywhere/gitconfig.txt | while IFS='=' read -r key val; do [ -z "$key" ] || [ -z "$val" ] && continue; current=$(git config --global --get "$key"); [ "$current" != "$val" ] && git config --global "$key" "$val"; done
```
