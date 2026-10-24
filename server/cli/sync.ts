// npm run sync            → incremental sync
// npm run sync -- --full  → re-download everything
import '../env'
import { tableCounts } from '../db'
import { runSync } from '../garmin/sync'

try {
  await runSync({ full: process.argv.includes('--full') })
  console.log('Stored:', tableCounts())
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
