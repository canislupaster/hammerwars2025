#!/bin/bash
set -euxo pipefail
export $(cat scripts/.deployenv | xargs)
rsync -urchavzP --stats . $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH --include='**.gitignore' --exclude='/.git' --include="scripts/.env" --filter=':- .gitignore' --delete-after
ssh -tt $REMOTE_USER@$REMOTE_HOST "
	set -euxo pipefail
	cd $REMOTE_PATH/scripts
	pnpm i --filter='scripts'
	sudo mv daemon.service /etc/systemd/system/hammerwars.service
	sudo systemctl daemon-reload
	sudo systemctl enable --now hammerwars.service
"