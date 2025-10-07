# you should name the computer before running this
# so in terminal:
# sudo scutil --set ComputerName debbie
# sudo scutil --set LocalHostName debbie
# sudo scutil --set HostName debbie

# very nice prompt, downstream of OMZ / robbyrussell theme
setopt promptsubst
autoload -U colors && colors
precmd() {
  depth=$(( ${#${(s:/:)PWD}} - 1 ))
  dirname=$([[ $PWD == $HOME ]] && echo "~" || basename "$PWD")
}
arrow='%(?:%F{green}➜%f:%F{red}➜%f)'
PROMPT='%B${arrow}%b %B%F{blue}%m%f%b %B%F{cyan}/[$depth]/$dirname%f%b $(git_prompt_info)'
