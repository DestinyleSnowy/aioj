#!/usr/bin/env bash
set -euo pipefail

KEY_PATH="${HOME}/.ssh/aioj_github_actions_deploy"
COMMENT="github-actions-aioj-deploy"

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

if [ -f "${KEY_PATH}" ]; then
  echo "Key already exists: ${KEY_PATH}"
else
  ssh-keygen -t ed25519 -C "${COMMENT}" -f "${KEY_PATH}" -N ""
fi

touch "${HOME}/.ssh/authorized_keys"
chmod 600 "${HOME}/.ssh/authorized_keys"

PUB="$(cat "${KEY_PATH}.pub")"
if grep -qxF "${PUB}" "${HOME}/.ssh/authorized_keys"; then
  echo "Public key already present in authorized_keys"
else
  echo "${PUB}" >> "${HOME}/.ssh/authorized_keys"
  echo "Public key appended to authorized_keys"
fi

echo
echo "Add these GitHub repository secrets:"
echo
echo "VM_HOST:"
curl -fsS ifconfig.me || hostname -I | awk '{print $1}'
echo
echo
echo "VM_USER:"
whoami
echo
echo
echo "VM_PORT:"
echo "22"
echo
echo "VM_PATH:"
pwd
echo
echo
echo "VM_SSH_KEY:"
echo "----- copy everything below this line into the secret -----"
cat "${KEY_PATH}"
echo "----- copy everything above this line into the secret -----"
echo
echo "After you add VM_SSH_KEY to GitHub, you may delete the private key from this VM:"
echo "  rm ${KEY_PATH}"
echo
echo "Keep the .pub key and authorized_keys entry."
