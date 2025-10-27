#!/bin/bash
set -euxo pipefail
export $(cat .deployenv | xargs)
cd client && npm run build && cd ..
rsync -urchavzP --stats . $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH --include='**.gitignore' --exclude="/.git" --exclude="/devdocs" --exclude="/scripts" --filter=':- .gitignore'
rsync -urchavzP --stats ./client/dist/* $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/client/dist
scp ./server/.env.production.local $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/server/.env
ssh -tt $REMOTE_USER@$REMOTE_HOST "
	set -euxo pipefail
	cd $REMOTE_PATH
	pnpm i
	supervisorctl -c $SUPERVISOR_CONF stop $SUPERVISOR_NAME || true
	supervisorctl -c $SUPERVISOR_CONF start $SUPERVISOR_NAME
"