# split-statements.awk
#
# Strips "-- " comment lines (tag headers, explanations) from a
# needs-review.<db>.sql file and prints one FULL SQL statement per output
# line, flattening any statement that spans multiple source lines (e.g. a
# multi-column ALTER TABLE) into a single line — so downstream bash regex
# matching (done per-line with [[ =~ ]]) always sees one complete statement.
#
# Usage: awk -f split-statements.awk <needs-review-file>

BEGIN { buf = "" }

/^[[:space:]]*--/ { next }
/^[[:space:]]*$/ { next }

{
  line = $0
  gsub(/^[ \t]+|[ \t]+$/, "", line)
  buf = (buf == "") ? line : buf " " line
  if (buf ~ /;[[:space:]]*$/) {
    print buf
    buf = ""
  }
}

END {
  gsub(/^[ \t]+|[ \t]+$/, "", buf)
  if (buf != "") print buf
}
