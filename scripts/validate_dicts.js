const fs = require('node:fs');
const path = require('node:path');

function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
}

function validateDicts(directory = path.join(__dirname, '../dicts')) {
    const seen = new Map();
    let valid = true;
    let entries = 0;
    try {
        const files = fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort();
        if (!files.length) throw new Error('No dictionary JSON files found.');
        for (const file of files) {
            const data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file}: dictionary root must be an object.`);
            for (const [key, value] of Object.entries(data)) {
                const normalized = normalizeText(key);
                if (!normalized || typeof value !== 'string' || !value.trim()) {
                    console.error(`${file}: empty key or non-string/empty translation for ${JSON.stringify(key)}.`);
                    valid = false;
                }
                if (['__proto__', 'prototype', 'constructor'].includes(normalized)) {
                    console.error(`${file}: reserved dictionary key ${JSON.stringify(key)}.`);
                    valid = false;
                }
                if (seen.has(normalized)) {
                    console.error(`${file}: normalized key ${JSON.stringify(key)} already exists in ${seen.get(normalized)}.`);
                    valid = false;
                }
                seen.set(normalized, file);
                entries++;
            }
        }
        if (!entries) throw new Error('Dictionaries contain no translations.');
    } catch (error) {
        console.error(`Dictionary validation failed: ${error.message}`);
        return false;
    }
    if (valid) console.log(`Simplified Chinese dictionaries valid (${entries} entries).`);
    return valid;
}

if (require.main === module) process.exitCode = validateDicts() ? 0 : 1;
module.exports = { validateDicts, normalizeText };
