#!/bin/bash
# usage: migrate.sh <service-short>
svc=$1
URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_${svc}_afr_test?schema=public"
host=$(echo "$URL" | sed -E 's#.*@([^/]+)/.*#\1#'); db=$(echo "$URL" | sed -E 's#.*/([^?]+)\?.*#\1#')
echo "TARGET host=$host db=$db"
if [ "$host" != "localhost:55433" ] || [[ "$db" != gymcoach_*_afr_test ]]; then echo ABORT; exit 9; fi
cd /d/admin-fr/backend/services/${svc}-service || exit 8
DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate deploy 2>&1 | tail -15
