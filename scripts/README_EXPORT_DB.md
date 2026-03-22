# Export Demo Database

Script: `scripts/export-demo-db.js`

## Muc dich

- Doc `DATABASE_URL` tu file `.env` o thu muc goc project.
- Ket noi PostgreSQL.
- Export schema + sample data (toi da 50 rows moi bang) trong schema `public`.
- Mask cac truong nhay cam trong du lieu mau.
- Ghi ket qua ra file `demo-db-export.json` o thu muc goc project.

## Cai package can thiet

Da cai trong workspace root:

```bash
pnpm add -w pg dotenv
```

Neu chua co, chay lai lenh tren truoc khi export.

## Cach chay

Tai thu muc goc project:

```bash
node scripts/export-demo-db.js
```

## Output

File output:

- `demo-db-export.json`

Format tong quat:

```json
{
  "databaseType": "postgresql",
  "exportedAt": "...",
  "tables": [
    {
      "tableName": "users",
      "columns": [
        {
          "columnName": "id",
          "dataType": "text",
          "isNullable": false,
          "isPrimaryKey": true,
          "foreignKey": null
        }
      ],
      "primaryKeys": ["id"],
      "foreignKeys": [],
      "sampleRows": []
    }
  ]
}
```

## Truong nhay cam duoc mask

Script se mask cac key co ten bang hoac chua cac chuoi sau (khong phan biet hoa thuong):

- `password`
- `password_hash`
- `token`
- `refresh_token`
- `secret`
- `otp`

Gia tri sau khi mask: `***MASKED***`

## Luu y

- Script chi doc du lieu (`SELECT`), khong ghi/chinh sua database.
- Neu 1 bang loi trong qua trinh export, script se log loi va tiep tuc bang tiep theo.
- Cuoi qua trinh se in tong so bang export thanh cong.
