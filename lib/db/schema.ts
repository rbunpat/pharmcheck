import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  lineUserId: text("line_user_id").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const allergies = pgTable(
  "allergies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Display name, e.g. "เพนิซิลลิน" */
    allergenName: text("allergen_name").notNull(),
    /** Keywords used for matching against drug ingredients / trade names */
    keywords: text("keywords").array().notNull(),
    source: text("source").notNull().default("preset"), // 'preset' | 'custom'
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("allergies_user_idx").on(t.userId)],
);

export const drugCache = pgTable(
  "drug_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Normalized registration number, e.g. "1A123/45" */
    registrationNo: text("registration_no").notNull().unique(),
    nameTh: text("name_th"),
    nameEn: text("name_en"),
    /** FDA license status text, e.g. "อนุญาตให้ผลิต/นำเข้า" */
    status: text("status"),
    manufacturer: text("manufacturer"),
    /** OCR-extracted or FDA-provided ingredients */
    ingredients: text("ingredients").array(),
    rawXml: text("raw_xml"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("drug_cache_name_idx").on(t.nameEn)],
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lineUserId: text("line_user_id"),
    ocrFields: jsonb("ocr_fields"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    matchedRegNo: text("matched_reg_no"),
    flags: text("flags").array(),
    decision: text("decision"), // 'INFO' | 'REFER' | 'RETAKE'
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scans_user_idx").on(t.lineUserId)],
);
