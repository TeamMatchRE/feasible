/**
 * Seeds Heritage Point Development and The Enclave.
 *
 * Run once:  NODE_OPTIONS="--conditions=react-server" npx tsx scripts/seed-heritage-point.ts
 * Idempotent — re-running updates in place rather than duplicating.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *
 * Real, from David or from the public site: the company, its tagline and brand
 * colours (sampled from heritagepointdevelopment.com), the address, the 8-lot
 * count, the 55+ positioning, the two home styles and their prices, and the
 * three investors with their commitment amounts.
 *
 * Deliberately left EMPTY rather than invented:
 *   · which lot is a Ranch and which is a Cape — nobody said, so no lot carries
 *     a style or a price. Assign them in the Lots tab and the price follows the
 *     style.
 *   · investor email, phone and address — these exist in Follow Up Boss, and
 *     importing them needs FUB_API_KEY. Typing plausible ones would be worse
 *     than leaving them blank.
 *   · contributed amounts — a commitment is not cash received. All three start
 *     at $0 contributed against their commitment.
 */
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
import postgres from "postgres";

const ENCLAVE_FOLDER = "1JMLBmN-MaNmATglUzoXQ4okljUt932ez";

/** Sampled from the live site: forest green, sage, cream, near-black. */
const HPD_BRAND = {
  primary: "#0A330F",
  accent: "#86AA5D",
  paper: "#F6F1E6",
  ink: "#1C1C1C",
  displayFont: "Playfair Display",
  bodyFont: "Afacad Flux",
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  try {
    // ---- Companies ------------------------------------------------------
    const [hpd] = await sql<{ id: string }[]>`
      insert into feasible.companies
        (slug, name, legal_name, tagline, website, brand, email_from_name, email_from_address)
      values ('heritage-point', 'Heritage Point Development', 'Heritage Point Development, LLC',
              'Bespoke homes. Timeless surroundings. A simpler way to live.',
              'https://www.heritagepointdevelopment.com',
              ${JSON.stringify(HPD_BRAND)}::jsonb,
              'David Brooke', 'david@brookegrouprealestate.com')
      on conflict (slug) do update set
        name = excluded.name, legal_name = excluded.legal_name, tagline = excluded.tagline,
        website = excluded.website, brand = excluded.brand,
        email_from_name = excluded.email_from_name, email_from_address = excluded.email_from_address,
        updated_at = now()
      returning id`;

    const [bgre] = await sql<{ id: string }[]>`
      insert into feasible.companies (slug, name, legal_name, email_from_name, email_from_address)
      values ('brooke-group', 'Brooke Group Real Estate', 'Brooke Group Real Estate, LLC',
              'David Brooke', 'david@brookegrouprealestate.com')
      on conflict (slug) do update set name = excluded.name, updated_at = now()
      returning id`;

    for (const email of ["david@brookegrouprealestate.com", "nickd@brookegrouprealestate.com"]) {
      await sql`
        insert into feasible.company_members (company_id, email, role)
        values (${hpd.id}, ${email}, 'owner')
        on conflict (company_id, lower(email)) do update set role = 'owner'`;
    }
    await sql`
      insert into feasible.company_members (company_id, email, role)
      values (${bgre.id}, 'david@brookegrouprealestate.com', 'owner')
      on conflict (company_id, lower(email)) do update set role = 'owner'`;

    // Existing deals belong to Brooke Group.
    await sql`update feasible.mf_deals set company_id = ${bgre.id} where company_id is null`;

    // ---- The Enclave ----------------------------------------------------
    const [owner] = await sql<{ id: string }[]>`
      select id from feasible.profiles where email = 'david@brookegrouprealestate.com'`;

    let [project] = await sql<{ id: string }[]>`
      select id from feasible.mf_deals where company_id = ${hpd.id} and name = 'The Enclave'`;

    if (!project) {
      [project] = await sql<{ id: string }[]>`
        insert into feasible.mf_deals
          (owner_id, company_id, name, address, city, state, stage, notes)
        values (${owner.id}, ${hpd.id}, 'The Enclave',
                '215 Chamberlain Hill Road', 'Higganum', 'CT', 'construction',
                ${`8-lot 55+ active-adult community on 10+ acres. Two home styles: Ranch $699,900, Cape $769,900.
HOA covers landscaping and snow removal; significant acreage held as permanent conservation.

⚠️ Drive, Zillow and the town record all use HADDAM for this address (06441); Higganum is the
village. Both are correct — change the city field if the legal record should read Haddam.

⚠️ Stage set to "construction" from what is in Drive (permits, foundation inspection, GES progress
photos, a remaining-infrastructure list) alongside live listings. Move it if that is wrong.`}
        )
        returning id`;

      // Every project needs a scenario to hold its underwriting (see 0009).
      const [scenario] = await sql<{ id: string }[]>`
        insert into feasible.mf_scenarios (deal_id, name, sort_order)
        values (${project.id}, 'Base case', 0) returning id`;
      await sql`update feasible.mf_deals set active_scenario_id = ${scenario.id} where id = ${project.id}`;
    }

    // Link the Drive folder we were given. The rest populate when Drive connects.
    await sql`
      insert into feasible.project_drive_links (project_id, label, stage, folder_id, url)
      values (${project.id}, '215 Chamberlain Hill Road', null, ${ENCLAVE_FOLDER},
              ${`https://drive.google.com/drive/folders/${ENCLAVE_FOLDER}`})
      on conflict (project_id, folder_id) do nothing`;

    // ---- Lots -----------------------------------------------------------
    // Eight lots, no style and no price: which lot is a Ranch and which is a
    // Cape has not been stated, and guessing would put fake revenue on screen.
    const existingLots = await sql<{ n: number }[]>`
      select count(*)::int as n from feasible.project_lots where project_id = ${project.id}`;
    if (existingLots[0].n === 0) {
      for (let i = 1; i <= 8; i++) {
        await sql`
          insert into feasible.project_lots (project_id, lot_number, status, sort_order)
          values (${project.id}, ${`Lot ${i}`}, 'available', ${i})`;
      }
    }

    // ---- Investors ------------------------------------------------------
    const investors = [
      { name: "Paul Stern", committed: 100_000 },
      { name: "Ishay Stein", committed: 200_000 },
      { name: "Steven Karpf", committed: 100_000 },
    ];

    for (const inv of investors) {
      const [row] = await sql<{ id: string }[]>`
        insert into feasible.investors (company_id, name, notes)
        values (${hpd.id}, ${inv.name},
                'Contact details are in Follow Up Boss — import needs FUB_API_KEY.')
        on conflict do nothing
        returning id`;

      const id =
        row?.id ??
        (
          await sql<{ id: string }[]>`
            select id from feasible.investors where company_id = ${hpd.id} and name = ${inv.name}`
        )[0].id;

      await sql`
        insert into feasible.investments
          (project_id, investor_id, committed_amount, contributed_amount, status)
        values (${project.id}, ${id}, ${inv.committed}, 0, 'committed')
        on conflict (project_id, investor_id) do update set
          committed_amount = excluded.committed_amount, updated_at = now()`;
    }

    // ---- Report ---------------------------------------------------------
    const summary = await sql<Record<string, unknown>[]>`
      select c.name as company, d.name as project, d.stage, d.city, d.state,
             (select count(*) from feasible.project_lots l where l.project_id = d.id)::int as lots,
             (select coalesce(sum(i.committed_amount), 0) from feasible.investments i where i.project_id = d.id) as committed,
             (select count(*) from feasible.investments i where i.project_id = d.id)::int as investors
      from feasible.mf_deals d join feasible.companies c on c.id = d.company_id
      order by c.name, d.name`;
    console.table(summary);
  } finally {
    await sql.end();
  }
}

main();
