import { mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('This service helper requires macOS. Use npm start on other systems.');
const root = fileURLToPath(new URL('../', import.meta.url));
const label = 'local.pose-studio';
const domain = `gui/${process.getuid()}`;
const plist = path.join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const action = process.argv[2];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
if (action === 'install') {
  await access(path.join(root, 'dist-server/server.js'));
  await mkdir(path.dirname(plist), { recursive: true });
  await mkdir(path.join(root, 'logs'), { recursive: true });
  await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(root, 'dist-server/server.js'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>REQUIRE_ZEROTIER</key><string>1</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${escape(path.join(root, 'logs/server.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(root, 'logs/server.error.log'))}</string>
</dict></plist>
`);
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
  // bootout returns before launchd has necessarily finished removing the job.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  console.log(`Installed ${label}. Logs: ${path.join(root, 'logs')}`);
} else if (action === 'stop') {
  execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'inherit' });
  console.log('Pose Studio stopped. Run npm run service:install to start it again.');
} else if (action === 'status') {
  execFileSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'inherit' });
} else throw new Error('Use install, stop, or status.');
