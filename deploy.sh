#!/bin/bash
set -euxo pipefail
export $(cat .deployenv | xargs)
cd client && npm run build && cd ..
scp "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/server/db.sqlite" "$BACKUP_PATH/db-$(date +%s).sqlite"
rsync -rchavzP --stats . $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH --filter="merge .rsync-filter-server" --exclude="*"
scp ./server/.env.production.local $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/server/.env
ssh -tt $REMOTE_USER@$REMOTE_HOST "
	set -euxo pipefail
	cd $REMOTE_PATH
	pnpm i
	supervisorctl -c $SUPERVISOR_CONF stop $SUPERVISOR_NAME || true
	supervisorctl -c $SUPERVISOR_CONF start $SUPERVISOR_NAME
"