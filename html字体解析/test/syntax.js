'use strict';
/* 语法检查：app.js 等前端脚本一旦出现语法错误，页面会整体白屏且不易察觉 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  });
})(path.join(root, 'js'));

let bad = 0;
files.forEach((f) => {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log('✗ 语法错误：' + path.relative(root, f));
    console.log(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
});
console.log(bad ? '\n发现 ' + bad + ' 个语法错误' : '全部 ' + files.length + ' 个 JS 文件语法检查通过 ✓');
process.exit(bad ? 1 : 0);
