#!/bin/bash
set -euxo pipefail
export $(cat scripts/.deployenv | xargs)
rsync -rchavzP --stats . $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH --filter='merge .rsync-filter-daemon'
scp ./scripts/.env.daemon.local $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/scripts/.env
ssh -tt $REMOTE_USER@$REMOTE_HOST "
	set -euxo pipefail
	sudo -i bash -c \"cd $REMOTE_PATH && pnpm i --filter='scripts'\"
	sudo mv $REMOTE_PATH/scripts/daemon.service /etc/systemd/system/hammerwars.service
	sudo systemctl daemon-reload
	sudo systemctl enable --now hammerwars.service
	sudo systemctl stop hammerwars.service
	sudo systemctl start hammerwars.service
"