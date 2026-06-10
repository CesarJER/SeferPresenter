import json

with open('presentations.json', 'r', encoding='utf-8') as f:
    presentations = json.load(f)

modified = False
for p in presentations:
    if 'slides' in p:
        for slide in p['slides']:
            if 'lines' in slide:
                for i, line in enumerate(slide['lines']):
                    if line.strip().startswith('[VIDEO'):
                        # [VIDEO - "ruta_video" - volumen - velocidad - bucle - inicio - fin]
                        inner = line.strip()[line.find('[')+6:-1].strip()
                        parts = [x.strip() for x in inner[1:].split(' - ')]
                        
                        rawSrc = parts[0]
                        volRaw = parts[1] if len(parts) > 1 else '1'
                        speedRaw = parts[2] if len(parts) > 2 else '1'
                        loopRaw = parts[3] if len(parts) > 3 else '1'
                        startRaw = parts[4] if len(parts) > 4 else ''
                        endRaw = parts[5] if len(parts) > 5 else ''
                        
                        # Format as MEDIA:
                        # [MEDIA - ruta - fit - nav - showBg - loop - vol - speed - start - end]
                        newParts = ['[MEDIA']
                        newParts.append(rawSrc) # ruta
                        newParts.append('cover') # fit
                        newParts.append('1') # nav
                        newParts.append('0') # showBg
                        newParts.append('1' if loopRaw != '0' else '0') # loop
                        newParts.append(volRaw) # vol
                        newParts.append(speedRaw) # speed
                        
                        if startRaw:
                            newParts.append(startRaw)
                            if endRaw:
                                newParts.append(endRaw)
                        elif endRaw:
                            newParts.append('')
                            newParts.append(endRaw)
                        
                        while len(newParts) > 2:
                            last = newParts[-1]
                            if (len(newParts) == 3 and last == 'cover') or \
                               (len(newParts) == 4 and last == '1') or \
                               (len(newParts) == 5 and last == '0') or \
                               (len(newParts) == 6 and last == '1') or \
                               (len(newParts) == 7 and last == '1') or \
                               (len(newParts) == 8 and last == '1'):
                                newParts.pop()
                            else:
                                break
                        
                        newText = ' - '.join(newParts) + ']'
                        slide['lines'][i] = newText
                        modified = True
                        print(f'Migrated: {line} -> {newText}')

if modified:
    with open('presentations.json', 'w', encoding='utf-8') as f:
        json.dump(presentations, f, indent=2, ensure_ascii=False)
    print('Successfully updated presentations.json')
else:
    print('No [VIDEO] tags found to migrate.')
