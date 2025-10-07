# you should name the computer before running this
# so in terminal:
# sudo scutil --set ComputerName debbie
# sudo scutil --set LocalHostName debbie
# sudo scutil --set HostName debbie

# very nice prompt, downstream of OMZ / robbyrussell theme
setopt promptsubst
autoload -U colors && colors

precmd() {
  if [[ $PWD == "/" ]]; then
    prompt_path="/"
  else
    depth=$(( $(echo "$PWD" | awk -F/ '{print NF-1}') - 1 ))
    dirname=$([[ $PWD == $HOME ]] && echo "~" || basename "$PWD")
    [[ $depth == 0 ]] && prompt_path="/$dirname" || prompt_path="/[$depth]/$dirname"
  fi
}

arrow='%(?:%F{green}➜%f:%F{red}➜%f)'
PROMPT='%B${arrow}%b %B%F{blue}%m%f%b %B%F{cyan}${prompt_path}%f%b $(git_prompt_info)'
