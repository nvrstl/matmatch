// Load .env into process.env (Node ≥ 22 has this built in).
import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile('.env')
