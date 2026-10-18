ALTER TABLE "sauces" ADD COLUMN IF NOT EXISTS "color" text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
UPDATE "sauces" s SET "color" = (ARRAY['saffron','tomato','olive','teal','plum','blue','rose','clay'])[((n.rn - 1) % 8) + 1]
FROM (SELECT id, row_number() OVER (ORDER BY name) AS rn FROM "sauces") n
WHERE n.id = s.id AND s."color" = 'slate';
