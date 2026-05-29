import { pool } from "../server/db";
import { assignNewStopsToRoutes } from "../server/services/weekly-optimizer";

const COMPANY_NAME = "Poop Scoop Pet Waste Solutions LTD";
const TIMEZONE = "America/Los_Angeles";
const TOTAL_CONTACTS = 250;

const FIRST_NAMES = [
  "James",
  "Mary",
  "John",
  "Patricia",
  "Robert",
  "Jennifer",
  "Michael",
  "Linda",
  "William",
  "Barbara",
  "David",
  "Elizabeth",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
  "Christopher",
  "Lisa",
  "Daniel",
  "Nancy",
  "Matthew",
  "Betty",
  "Anthony",
  "Margaret",
  "Mark",
  "Sandra",
  "Donald",
  "Ashley",
  "Steven",
  "Dorothy",
  "Paul",
  "Kimberly",
  "Andrew",
  "Emily",
  "Joshua",
  "Donna",
  "Kenneth",
  "Michelle",
  "Kevin",
  "Carol",
  "Brian",
  "Amanda",
  "George",
  "Melissa",
  "Timothy",
  "Deborah",
  "Ronald",
  "Stephanie",
  "Edward",
  "Rebecca",
  "Jason",
  "Sharon",
  "Jeffrey",
  "Laura",
  "Ryan",
  "Cynthia",
  "Jacob",
  "Kathleen",
  "Gary",
  "Amy",
  "Nicholas",
  "Angela",
  "Eric",
  "Shirley",
  "Jonathan",
  "Anna",
  "Stephen",
  "Brenda",
  "Larry",
  "Pamela",
  "Justin",
  "Emma",
  "Scott",
  "Nicole",
  "Brandon",
  "Helen",
  "Benjamin",
  "Samantha",
  "Samuel",
  "Katherine",
  "Raymond",
  "Christine",
  "Gregory",
  "Debra",
  "Frank",
  "Rachel",
  "Alexander",
  "Carolyn",
  "Patrick",
  "Janet",
  "Jack",
  "Catherine",
  "Dennis",
  "Maria",
  "Jerry",
  "Heather",
  "Tyler",
  "Diane",
  "Aaron",
  "Julie",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
  "Young",
  "Allen",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Flores",
  "Green",
  "Adams",
  "Nelson",
  "Baker",
  "Hall",
  "Rivera",
  "Campbell",
  "Mitchell",
  "Carter",
  "Roberts",
  "Gomez",
  "Phillips",
  "Evans",
  "Turner",
  "Diaz",
  "Parker",
  "Cruz",
  "Edwards",
  "Collins",
  "Reyes",
  "Stewart",
  "Morris",
  "Morales",
  "Murphy",
  "Cook",
  "Rogers",
  "Gutierrez",
  "Ortiz",
  "Morgan",
  "Cooper",
  "Peterson",
  "Bailey",
  "Reed",
  "Kelly",
  "Howard",
  "Ramos",
  "Kim",
  "Cox",
  "Ward",
  "Richardson",
  "Watson",
  "Brooks",
  "Chavez",
  "Wood",
  "James",
  "Bennett",
  "Gray",
  "Mendoza",
  "Ruiz",
  "Hughes",
  "Price",
  "Alvarez",
  "Castillo",
  "Sanders",
  "Patel",
  "Myers",
  "Long",
  "Ross",
  "Foster",
  "Jimenez",
  "Powell",
  "Jenkins",
  "Perry",
  "Russell",
];

const BELLINGHAM_STREETS = [
  "Meridian St",
  "Lakeway Dr",
  "Alabama St",
  "King St",
  "Cornwall Ave",
  "Railroad Ave",
  "Ellis St",
  "Holly St",
  "Magnolia Ave",
  "Douglas Ave",
  "Sunset Dr",
  "Lincoln St",
  "Grant St",
  "Monroe St",
  "State St",
  "Bay St",
  "Maple St",
  "Oak St",
  "Cedar St",
  "Pine St",
  "Birch St",
  "Elm St",
  "Walnut Ave",
  "Chestnut Ave",
  "Alder St",
  "Iowa St",
  "Kentucky St",
  "Virginia St",
  "Michigan St",
  "Indiana St",
  "Ohio St",
  "Wisconsin St",
  "Missouri St",
  "Illinois St",
  "Texas St",
  "Cable St",
  "Bill McDonald Pkwy",
  "James St",
  "Champion St",
  "Stuart Rd",
  "Donovan Ave",
  "Connelly Ave",
  "Yew St",
  "Fir St",
  "Spruce St",
  "Garden St",
  "Forest St",
  "Valley Dr",
  "Ridge Dr",
  "Hill Dr",
  "Park Ave",
  "Lake Dr",
  "Shore Dr",
  "Bay Dr",
  "Crest Dr",
  "View Dr",
  "Summit Dr",
  "Meadow Ln",
  "Woodland Dr",
  "Hillcrest Dr",
];

const ZIP_CODES = ["98225", "98226", "98229"];
const ZIP_WEIGHTS = [0.4, 0.35, 0.25];
const YARD_SIZES = ["small", "medium", "large"];
const YARD_DIFFICULTIES = ["flat", "moderate", "difficult"];
const FREQUENCIES = ["weekly", "biweekly", "monthly"];
const FREQ_WEIGHTS = [0.5, 0.35, 0.15];
const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "comcast.net",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return items[i];
  }
  return items[items.length - 1];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone(): string {
  const area = randomInt(200, 999);
  const prefix = randomInt(200, 999);
  const line = randomInt(1000, 9999);
  return `(${area}) ${prefix}-${line}`;
}

function randomEmail(firstName: string, lastName: string, index: number): string {
  const domain = pick(EMAIL_DOMAINS);
  const variants = [
    `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}`,
    `${firstName.toLowerCase()}${lastName.toLowerCase().charAt(0)}${index}@${domain}`,
    `${firstName.toLowerCase().charAt(0)}${lastName.toLowerCase()}${index}@${domain}`,
  ];
  return pick(variants);
}

function randomContactStatus(): string {
  const r = Math.random();
  if (r < 0.8) return "active";
  if (r < 0.9) return "paused";
  return "cancelled";
}

function randomFrequency(): string {
  return weightedPick(FREQUENCIES, FREQ_WEIGHTS);
}

function randomPrice(frequency: string, numberOfDogs: number): number {
  const basePrices: Record<string, number> = {
    weekly: 18,
    biweekly: 28,
    monthly: 42,
  };
  const base = basePrices[frequency] ?? 25;
  const dogSurcharge = (numberOfDogs - 1) * 5;
  const noise = randomInt(-2, 5);
  const price = base + dogSurcharge + noise;
  return Math.max(15, Math.min(55, price));
}

function randomStartDate(): string {
  const now = new Date();
  const monthsBack = randomInt(6, 18);
  const start = new Date(now);
  start.setMonth(start.getMonth() - monthsBack);
  start.setDate(randomInt(1, 28));
  return start.toISOString().split("T")[0];
}

async function main() {
  console.log("Starting Poop Scoop seed script...");

  // Find or create the company
  let companyRes = await pool.query(`SELECT id, timezone FROM companies WHERE name = $1 LIMIT 1`, [
    COMPANY_NAME,
  ]);

  let companyId: string;

  if (companyRes.rows.length === 0) {
    console.log(`Creating company: ${COMPANY_NAME}`);
    const insertRes = await pool.query(
      `INSERT INTO companies (name, timezone, subscription_tier, subscription_status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [COMPANY_NAME, TIMEZONE, "tier_6_10", "active"]
    );
    companyId = insertRes.rows[0].id;
    console.log(`Company created with id: ${companyId}`);
  } else {
    companyId = companyRes.rows[0].id;
    console.log(`Found existing company with id: ${companyId}`);
    if (companyRes.rows[0].timezone !== TIMEZONE) {
      await pool.query(`UPDATE companies SET timezone = $1 WHERE id = $2`, [TIMEZONE, companyId]);
      console.log("Updated company timezone to America/Los_Angeles");
    }
  }

  // Idempotency check
  const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE company_id = $1`, [
    companyId,
  ]);
  const existingCount = parseInt(countRes.rows[0].cnt, 10);

  if (existingCount > 10) {
    console.log(`Company already has ${existingCount} contacts. Skipping seed (idempotent).`);
    await pool.end();
    process.exit(0);
  }

  console.log(`Seeding ${TOTAL_CONTACTS} contacts...`);

  let inserted = 0;
  for (let i = 0; i < TOTAL_CONTACTS; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = randomEmail(firstName, lastName, i);
    const phone = randomPhone();
    const status = randomContactStatus();
    const numberOfDogs = randomInt(1, 4);
    const yardSize = pick(YARD_SIZES);
    const yardDifficulty = pick(YARD_DIFFICULTIES);
    const zipCode = weightedPick(ZIP_CODES, ZIP_WEIGHTS);
    const streetAddress = `${randomInt(100, 9999)} ${pick(BELLINGHAM_STREETS)}`;
    const frequency = randomFrequency();
    const dayOfWeek = pick(DAYS_OF_WEEK);
    const pricePerVisit = randomPrice(frequency, numberOfDogs).toFixed(2);
    const startDate = randomStartDate();
    // Insert contact
    const contactRes = await pool.query(
      `INSERT INTO contacts
         (company_id, first_name, last_name, email, phone, street_address, city, state, zip_code,
          number_of_dogs, yard_size, service_frequency, service_day, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        companyId,
        firstName,
        lastName,
        email,
        phone,
        streetAddress,
        "Bellingham",
        "WA",
        zipCode,
        numberOfDogs,
        yardSize,
        frequency,
        dayOfWeek,
        status,
      ]
    );
    const contactId = contactRes.rows[0].id;

    // Insert property
    const propertyRes = await pool.query(
      `INSERT INTO properties
         (company_id, contact_id, street_address, city, state, zip_code,
          number_of_dogs, yard_size, yard_difficulty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        companyId,
        contactId,
        streetAddress,
        "Bellingham",
        "WA",
        zipCode,
        numberOfDogs,
        yardSize,
        yardDifficulty,
      ]
    );
    const propertyId = propertyRes.rows[0].id;

    // Insert service plan
    await pool.query(
      `INSERT INTO service_plans
         (company_id, contact_id, property_id, frequency, day_of_week, price_per_visit,
          is_active, job_status, start_date, job_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        contactId,
        propertyId,
        frequency,
        dayOfWeek,
        pricePerVisit,
        true,
        "active",
        startDate,
        "recurring",
      ]
    );

    inserted++;
    if (inserted % 50 === 0) {
      console.log(`  ${inserted}/${TOTAL_CONTACTS} contacts inserted...`);
    }
  }

  console.log(`\nDone! Inserted ${inserted} contacts with properties and service plans.`);
  console.log(`Company: ${COMPANY_NAME} (id: ${companyId})`);

  // Read company maxStopsPerRoute setting (default 30 for demo purposes).
  const companySettingsRes = await pool.query(
    `SELECT max_stops_per_route FROM companies WHERE id = $1`,
    [companyId]
  );
  const MAX_STOPS: number = companySettingsRes.rows[0]?.max_stops_per_route ?? 30;

  // Assign service plans to routes using the cap-aware helper.
  console.log(`\nAssigning service plans to routes (maxStopsPerRoute = ${MAX_STOPS})...`);

  const planRows = await pool.query(
    `SELECT sp.id AS plan_id, sp.property_id, sp.day_of_week, p.latitude, p.longitude
     FROM service_plans sp
     LEFT JOIN properties p ON p.id = sp.property_id
     WHERE sp.company_id = $1 AND sp.is_active = true AND sp.day_of_week IS NOT NULL`,
    [companyId]
  );

  const newStops = planRows.rows
    .filter((r: { day_of_week: string | null }) => r.day_of_week && r.day_of_week !== "tbd")
    .map(
      (r: {
        plan_id: string;
        property_id: string;
        day_of_week: string;
        latitude: string | null;
        longitude: string | null;
      }) => ({
        planId: r.plan_id,
        propertyId: r.property_id,
        dayOfWeek: r.day_of_week,
        lat: r.latitude ? Number(r.latitude) : null,
        lng: r.longitude ? Number(r.longitude) : null,
      })
    );

  const { assignments, newRoutes } = await assignNewStopsToRoutes(
    newStops,
    [],
    async (name: string, day: string) => {
      const res = await pool.query(
        `INSERT INTO routes (company_id, name, day_of_week)
         VALUES ($1, $2, $3)
         RETURNING id, name`,
        [companyId, name, day]
      );
      return { id: res.rows[0].id, name: res.rows[0].name };
    },
    MAX_STOPS
  );

  for (const assignment of assignments) {
    await pool.query(`UPDATE service_plans SET route_id = $1 WHERE id = $2`, [
      assignment.routeId,
      assignment.planId,
    ]);
  }

  console.log(`Routes created: ${newRoutes.length}, stops assigned: ${assignments.length}`);

  // Verify counts
  const finalCounts = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM contacts WHERE company_id = $1) AS contacts,
       (SELECT COUNT(*) FROM properties WHERE company_id = $1) AS properties,
       (SELECT COUNT(*) FROM service_plans WHERE company_id = $1) AS service_plans,
       (SELECT COUNT(*) FROM routes WHERE company_id = $1) AS routes`,
    [companyId]
  );
  const counts = finalCounts.rows[0];
  console.log(
    `Verification — contacts: ${counts.contacts}, properties: ${counts.properties}, service_plans: ${counts.service_plans}, routes: ${counts.routes}`
  );

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  pool.end().finally(() => process.exit(1));
});
