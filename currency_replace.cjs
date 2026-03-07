const fs = require('fs');
const path = require('path');

const dirs = [
    'D:\\New folder\\.worker\\.economy',
    'D:\\New folder\\.worker\\.moderation\\src'
];

function processPath(targetPath) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
        const files = fs.readdirSync(targetPath);
        for (const file of files) {
            if (file !== 'node_modules') {
                processPath(path.join(targetPath, file));
            }
        }
    } else if (targetPath.endsWith('.js') || targetPath.endsWith('.json') || targetPath.endsWith('.txt')) {
        let content = fs.readFileSync(targetPath, 'utf8');
        let original = content;

        // Replace $${var} with €${var}
        content = content.replace(/\$\$\{/g, '€${');
        // Replace $100 with €100
        content = content.replace(/\$(?=\d)/g, '€');
        // Replace " bucks" with " euros"
        content = content.replace(/\bbucks\b/gi, 'euros');
        // Replace " buck" with " euro"
        content = content.replace(/\bbuck\b/gi, 'euro');

        if (content !== original) {
            console.log(`Updated: ${targetPath}`);
            fs.writeFileSync(targetPath, content, 'utf8');
        }
    }
}

dirs.forEach(d => {
    if (fs.existsSync(d)) {
        processPath(d);
    } else {
        console.log(`Directory not found: ${d}`);
    }
});

console.log('Currency replacement complete.');
