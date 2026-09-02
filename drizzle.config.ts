import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: './scripts/.dev.db',
  },
})
