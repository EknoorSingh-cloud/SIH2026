#!/bin/bash
set -e
cd "$(dirname "$0")"

CODE=$(node -e '
require("dotenv").config();
const db=require("./db"),crypto=require("crypto");
db.query("SELECT mfa_secret FROM users WHERE service_number=$1",["DL-INS-1001"]).then(r=>{
const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0,o=[];
for(const c of r.rows[0].mfa_secret){const i=A.indexOf(c);if(i<0)continue;v=(v<<5)|i;b+=5;if(b>=8){o.push((v>>>(b-8))&255);b-=8;}}
const buf=Buffer.alloc(8);buf.writeUInt32BE(Math.floor(Date.now()/1000/30),4);
const h=crypto.createHmac("sha1",Buffer.from(o)).update(buf).digest();const f=h[19]&15;
console.log(String(((((h[f]&127)<<24)|(h[f+1]<<16)|(h[f+2]<<8)|h[f+3])>>>0)%1000000).padStart(6,"0"));
process.exit(0);});')

MFA=$(curl -s -X POST localhost:5000/api/v1/auth/login -H "Content-Type: application/json" -d '{"service_number":"DL-INS-1001","password":"Test@1234"}' | sed 's/.*"mfa_token":"\([^"]*\)".*/\1/')
TOKEN=$(curl -s -X POST localhost:5000/api/v1/auth/mfa/verify -H "Content-Type: application/json" -d "{\"mfa_token\":\"$MFA\",\"code\":\"$CODE\"}" | sed 's/.*"session_token":"\([^"]*\)".*/\1/')
echo "token: ${TOKEN:0:16}..."

CASE=$(psql -U postgres -d sih_dms -t -A -c "SELECT id FROM cases WHERE case_number='FIR/0142/2026'")
echo "case:  $CASE"

echo "FIR 0142/2026 - test document" > /tmp/fir.txt

echo "--- UPLOAD ---"
curl -s -X POST localhost:5000/api/v1/documents -H "Authorization: Bearer $TOKEN" -F "case_id=$CASE" -F "title=Test FIR" -F "doc_type=fir" -F "file=@/tmp/fir.txt" | tee /tmp/up.json
echo

DOC=$(sed 's/.*"document_id":"\([^"]*\)".*/\1/' /tmp/up.json)

echo "--- VERIFY (clean) ---"
curl -s -X POST localhost:5000/api/v1/documents/$DOC/verify -H "Authorization: Bearer $TOKEN"
echo

echo "--- BSA S.63 CERTIFICATE (clean - should issue) ---"
curl -s -o /tmp/bsa63.pdf -w "http %{http_code}, %{size_download} bytes -> /tmp/bsa63.pdf\n" \
  localhost:5000/api/v1/documents/$DOC/certificate -H "Authorization: Bearer $TOKEN"

echo "--- SEARCH ---"
curl -s -G localhost:5000/api/v1/documents/search \
  --data-urlencode "q=test" -H "Authorization: Bearer $TOKEN"
echo

echo "--- ICJS FIR LOOKUP (mock) ---"
curl -s -G localhost:5000/api/v1/icjs/fir \
  --data-urlencode "fir_number=FIR/0142/2026" -H "Authorization: Bearer $TOKEN"
echo

echo "--- ICJS DOCUMENT PAYLOAD (mock, hash only - never the file) ---"
curl -s localhost:5000/api/v1/icjs/documents/$DOC/payload -H "Authorization: Bearer $TOKEN"
echo

echo "--- TAMPERING ---"
BLOB=$(ls -t uploads/*.enc | head -1)
printf 'X' | dd of="$BLOB" bs=1 seek=0 conv=notrunc 2>/dev/null
echo "corrupted $BLOB"

echo "--- VERIFY (tampered) ---"
curl -s -X POST localhost:5000/api/v1/documents/$DOC/verify -H "Authorization: Bearer $TOKEN"
echo

echo "--- BSA S.63 CERTIFICATE (tampered - must refuse with 409) ---"
curl -s -w "\nhttp %{http_code}\n" \
  localhost:5000/api/v1/documents/$DOC/certificate -H "Authorization: Bearer $TOKEN"

echo "--- AUDIT ---"
curl -s localhost:5000/api/v1/documents/$DOC/audit -H "Authorization: Bearer $TOKEN"
echo
