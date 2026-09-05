// Creates test users so you can actually log in.
// Run:  node -r dotenv/config scripts/seed.js
//
// Safe to run more than once - it clears and rebuilds the test data.

const db = require("../db");
const { hashPassword, generateMfaSecret, totpUri } = require("../services/crypto");

const PASSWORD = "Test@1234";

const USERS = [
    { service_number: "DL-INS-1001", name: "R. Sharma",  rank: "inspector",        station: "Connaught Place" },
    { service_number: "DL-SI-2002",  name: "P. Verma",   rank: "sub_inspector",    station: "Connaught Place" },
    { service_number: "DL-CON-3003", name: "A. Kumar",   rank: "constable",        station: "Connaught Place" },
    { service_number: "DL-PRO-4004", name: "S. Iyer",    rank: "prosecutor",       station: "Tis Hazari" },
    { service_number: "DL-FSL-5005", name: "N. Das",     rank: "forensic_analyst", station: "Rohini FSL" },
];

async function main() {
    console.log("Seeding...\n");

    // Order matters because of foreign keys.
    await db.query("DELETE FROM case_assignments");
    await db.query("DELETE FROM sessions");
    await db.query("DELETE FROM document_versions");
    await db.query("DELETE FROM documents");
    await db.query("DELETE FROM cases");
    await db.query("DELETE FROM users");

    const created = [];

    for (const u of USERS) {
        const secret = generateMfaSecret();
        const { rows } = await db.query(
            `INSERT INTO users
         (service_number, name, rank, station, password_hash, mfa_secret, mfa_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       RETURNING id`,
            [
                u.service_number,
                u.name,
                u.rank,
                u.station,
                await hashPassword(PASSWORD),
                secret,
            ]
        );
        created.push({ ...u, id: rows[0].id, secret });
    }

    const inspector = created.find((u) => u.rank === "inspector");

    // One ordinary case and one protected case, so you can demonstrate
    // that sensitivity actually changes behaviour.
    const normalCase = await db.query(
        `INSERT INTO cases (case_number, title, sensitivity, station, created_by)
     VALUES ($1,$2,'normal',$3,$4) RETURNING id`,
        ["FIR/0142/2026", "Theft - Connaught Place", "Connaught Place", inspector.id]
    );

    const protectedCase = await db.query(
        `INSERT INTO cases (case_number, title, sensitivity, station, created_by)
     VALUES ($1,$2,'protected',$3,$4) RETURNING id`,
        ["FIR/0198/2026", "Protected case - identity restricted", "Connaught Place", inspector.id]
    );

    // Deliberately NOT assigning the constable to anything, so you have
    // a user who fails the ABAC check even though their rank permits
    // viewing. That is the demo.
    for (const u of created.filter((c) => c.rank !== "constable")) {
        await db.query(
            `INSERT INTO case_assignments (case_id, user_id, assigned_by)
       VALUES ($1,$2,$3)`,
            [normalCase.rows[0].id, u.id, inspector.id]
        );
    }

    await db.query(
        `INSERT INTO case_assignments (case_id, user_id, assigned_by)
     VALUES ($1,$2,$3)`,
        [protectedCase.rows[0].id, inspector.id, inspector.id]
    );

    console.log(`Password for every user:  ${PASSWORD}\n`);
    console.log("Users:");
    for (const u of created) {
        console.log(`  ${u.service_number}  ${u.rank}`);
        console.log(`    MFA: ${totpUri(u.secret, u.service_number)}`);
    }

    console.log("\nCases:");
    console.log(`  FIR/0142/2026  normal     ${normalCase.rows[0].id}`);
    console.log(`  FIR/0198/2026  protected  ${protectedCase.rows[0].id}`);
    console.log("\nDL-CON-3003 is assigned to nothing. Use it to test denial.");

    await db.pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});