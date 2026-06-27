"""
Orbit Neural TTS
Uses Microsoft edge-tts for natural sounding voice
Usage: python orbit_tts.py "text" "voice-name"
"""
import sys
import os
import subprocess

# Auto-install missing packages before anything else
def ensure(pkg, pip_name=None):
    try:
        __import__(pkg)
    except ImportError:
        print(f'[TTS] Installing {pip_name or pkg}...')
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', pip_name or pkg, '--quiet'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception as e:
            print(f'[TTS] Install failed: {e}')

ensure('edge_tts', 'edge-tts')
ensure('pygame')

import asyncio
import tempfile
import time

try:
    import edge_tts
except ImportError:
    print('[TTS] edge-tts not available — cannot speak')
    sys.exit(1)

try:
    import pygame
    pygame.mixer.pre_init(frequency=24000, size=-16, channels=1, buffer=512)
    pygame.mixer.init()
except Exception as e:
    print(f'[TTS] pygame init failed: {e}')
    sys.exit(1)

# Voice map — natural neural voices
VOICES = {
    'en-GB-RyanNeural':        'en-GB-RyanNeural',
    'en-GB-ThomasNeural':      'en-GB-ThomasNeural',
    'en-US-GuyNeural':         'en-US-GuyNeural',
    'en-US-ChristopherNeural': 'en-US-ChristopherNeural',
    'nb-NO-FinnNeural':        'nb-NO-FinnNeural',
    'de-DE-ConradNeural':      'de-DE-ConradNeural',
    'fr-FR-HenriNeural':       'fr-FR-HenriNeural',
}

def clean(text):
    """Strip markdown, URLs, code blocks before speaking"""
    import re
    text = re.sub(r'```[\s\S]*?```', 'code block', text)
    text = re.sub(r'`[^`]+`', 'code', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'#{1,6}\s*', '', text)
    text = re.sub(r'https?://\S+', 'I have opened the link', text)
    text = re.sub(u'[\U0001F000-\U0001FFFF]', '', text)
    text = re.sub(r'\n+', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

async def generate_and_play(text, voice):
    """Generate audio with edge-tts and play with pygame"""
    fd, tmp = tempfile.mkstemp(suffix='.mp3')
    os.close(fd)
    try:
        # Generate with edge-tts
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate='+5%',
            volume='+0%'
        )
        await communicate.save(tmp)

        # Verify file was created
        if not os.path.exists(tmp) or os.path.getsize(tmp) < 100:
            print(f'[TTS] Generated file empty or missing')
            return

        # Play with pygame
        pygame.mixer.music.load(tmp)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(0.05)
        pygame.mixer.music.unload()
        print('[TTS] Playback complete')

    except Exception as e:
        print(f'[TTS] Error: {e}')
    finally:
        try: os.unlink(tmp)
        except: pass

if __name__ == '__main__':
    text  = sys.argv[1] if len(sys.argv) > 1 else 'Orbit online.'
    voice = sys.argv[2] if len(sys.argv) > 2 else 'en-GB-RyanNeural'

    # Use known voice or default
    voice = VOICES.get(voice, 'en-GB-RyanNeural')
    text  = clean(text)

    if not text:
        sys.exit(0)

    print(f'[TTS] Speaking with {voice}: {text[:60]}...' if len(text)>60 else f'[TTS] Speaking: {text}')
    asyncio.run(generate_and_play(text, voice))
