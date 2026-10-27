#!/usr/bin/env node
// Print the doctor report for the current directory: the setup facts, the
// plugin's reading of the Vale config per target, the raw section settings,
// and the warnings. Exit 1 when there are warnings, so a script can gate on it.
import { doctorReport, formatDoctor } from '../lib/doctor.js';

const report = doctorReport(process.cwd());
process.stdout.write(formatDoctor(report));
process.exit(report.warnings.length > 0 ? 1 : 0);
