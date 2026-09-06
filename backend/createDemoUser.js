require("dotenv").config();

const db = require("./db");
const { hashPassword } = require("./services/crypto");

async function createDemoUser() {
    try {

        const serviceNumber = "SIH001";
        const password = "demo123";

        const passwordHash = await hashPassword(password);

        const result = await db.query(
            `
            INSERT INTO users (
                service_number,
                name,
                rank,
                station,
                password_hash,
                mfa_enabled
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, service_number, name, rank, station;
            `,
            [
                serviceNumber,
                "Demo Officer",
                "inspector",
                "Delhi Police",
                passwordHash,
                false,
            ]
        );

        console.log("Demo user created successfully!");
        console.log(result.rows[0]);

        process.exit(0);

    } catch (error) {

        console.error("Error creating demo user:");
        console.error(error);

        process.exit(1);

    }
}

createDemoUser();