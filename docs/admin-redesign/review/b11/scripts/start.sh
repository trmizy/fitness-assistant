#!/bin/bash
# usage: start.sh <name> <dir> <port> <dbshort|none>
S=/c/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b11
source $S/stack.env.sh
name=$1; dir=$2; port=$3; db=$4
export PORT=$port
if [ "$db" != none ]; then export DATABASE_URL="$PGB/gymcoach_${db}_afr_test?schema=public"; echo "$name -> $(echo $DATABASE_URL | sed -E 's#://[^@]*@#://***@#')"; fi
export CORS_ORIGIN=http://localhost:45173
cd $dir || exit 1
nohup node node_modules/tsx/dist/cli.mjs src/server.ts > $S/$name.log 2>&1 &
echo $! > $S/$name.pid
