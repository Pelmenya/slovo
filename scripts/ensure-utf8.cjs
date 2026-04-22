// На Windows принудительно переключает console codepage в 65001 (UTF-8),
// чтобы эмодзи в bootstrap-логах (🚀, 📚) не превращались в кракозябры
// при запуске из Git Bash / cmd / PowerShell.
//
// На Mac/Linux — no-op, платформы умеют UTF-8 по умолчанию.

if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch {
        // chcp может отсутствовать в экзотическом окружении — не блокируем старт
    }
}
