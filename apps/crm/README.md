# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. The app is a skeleton: the backend serves `GET /api/health`, and the
frontend shows the result. The design is in
[docs/001-guiding-design.md](docs/001-guiding-design.md).

```bash
yarn workspace crm start           # FE on :4100, BE on :4101
yarn workspace crm start:docker    # the same, in dev containers
yarn workspace crm test:types
yarn workspace crm-be test
```

`DB_PATH` sets the SQLite file. The default is `crm-be/data/crm.db`, which git
ignores.
