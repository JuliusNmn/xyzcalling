"""Prepare source-video audio with deterministic tags for Motion Stage track matching."""
import concurrent.futures, json, pathlib, subprocess, sys, os
ROOT=pathlib.Path(__file__).resolve().parents[1]
VIDEOS=ROOT.parent.parent/'xyzcalling'/'videos'
PAYLOAD=pathlib.Path('/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/Audio/Motion Stage')
TRACKS=[
 ('real-house','Real House Dancing','Dance Capture','VJxjxXA3dCw','Real House Dancing.gvhmr.fbx','Real_House_Dancing_VJxjxXA3dCw.wav'),
 ('rumble','Rumble','Skrillex, Fred again.. & Flowdan','jnQItw0F7hU','Skrillex Fred Again.. Flowdan Rumble.gvhmr.fbx',None),
 ('wide-open','Wide Open','The Chemical Brothers feat. Beck','BC2dRkm8ATU','The Chemical Brothers - Wide Open (Official Music Video) ft. Beck.gvhmr.fbx',None),
 ('freestyler','Freestyler',"Bomfunk MC's",'ymNFyxvIdaM',"Bomfunk MC's - Freestyler (Video Original Version) [ymNFyxvIdaM].gvhmr.fbx",None),
 ('ready','Ready','Charmes feat. Da Professor','cGAU_Xa-Xl0','Charmes ft. Da Professor - Ready (Official Music Video) [cGAU_Xa-Xl0].gvhmr.fbx',None),
 ('first-of-year','First Of The Year','Skrillex','2k0icW6kl7w','First Of The Year - Skrillex - Mike Song, The Kinjaz Crew, Dubstep - 310XT Films - URBAN DANCE CAMP.gvhmr.fbx','First_Of_The_Year_UDC_2k0icW6kl7w.wav'),
 ('gal-a-bubble','Gal a Bubble','Konshens','pVLe-INswIs','Kirsten Dodgen choreography to “Gal a Bubble” by Konshens at Offstage Dance Studio.gvhmr.fbx',None),
]
def run(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 if p.returncode:raise RuntimeError(p.stdout[-4000:])
 return p.stdout

def prepare(t):
 ident,title,artist,video,fbx,existing=t
 entry={'id':ident,'title':title,'artist':artist,'sourceUrl':f'https://www.youtube.com/watch?v={video}','fbx':str(VIDEOS/fbx),'audio':str(PAYLOAD/(title+'.mp3'))}
 try:
  source=PAYLOAD.parent/existing if existing else None
  if source is None or not source.exists():
   source_dir=PAYLOAD/'sources';source_dir.mkdir(exist_ok=True)
   existing_sources=[p for p in source_dir.glob(video+'.*') if p.suffix in ['.m4a','.webm','.opus','.mp3','.mp4']]
   if existing_sources:source=existing_sources[0]
   else:
    print(f'DOWNLOAD {title}',flush=True)
    run([os.environ.get('YTDLP','yt-dlp'),'--js-runtimes','node','--no-playlist','--no-progress','--no-warnings','--socket-timeout','20','--retries','2','--force-ipv4','-f',os.environ.get('AUDIO_FORMAT','bestaudio'),'-o',str(source_dir/(video+'.%(ext)s')),entry['sourceUrl']])
    source=next(p for p in source_dir.glob(video+'.*') if p.suffix in ['.m4a','.webm','.opus','.mp3','.mp4'])
  output=pathlib.Path(entry['audio'])
  if not output.exists():
   run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-n','-i',str(source),'-vn','-c:a','libmp3lame','-b:a','320k','-id3v2_version','3','-metadata','title='+title,'-metadata','artist='+artist,'-metadata','album=Motion Stage - Source Video Edits','-metadata','comment='+entry['sourceUrl'],str(output)])
  probe=json.loads(run(['ffprobe','-v','error','-show_format','-of','json',str(output)]))['format']
  sidecar=next(p for p in VIDEOS.glob('*.gvhmr.json') if video in p.name)
  meta=json.loads(sidecar.read_text());entry.update(audioDuration=float(probe['duration']),captureDuration=meta['duration'],tags=probe.get('tags'),sourceAudio=str(source),status='ready')
  if abs(entry['audioDuration']-entry['captureDuration'])>1:entry['status']='duration-mismatch'
  print(f"{entry['status'].upper()} {title}: audio={entry['audioDuration']:.3f}s capture={entry['captureDuration']:.3f}s",flush=True)
 except Exception as error:entry.update(status='failed',error=str(error));print(f'FAILED {title}: {error}',flush=True)
 return entry
if __name__=='__main__':
 if not pathlib.Path('/Volumes/T7-2tb-2509').is_mount():sys.exit('SSD is not mounted; refusing to create a substitute path')
 PAYLOAD.mkdir(parents=True,exist_ok=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(prepare,TRACKS))
 (ROOT/'reports'/'track-audio.json').write_text(json.dumps(results,indent=2)+'\n')
 playlist='#EXTM3U\n'+''.join(f"#EXTINF:-1,{e['artist']} - {e['title']}\n{e['audio']}\n" for e in results if e['status']=='ready')
 (PAYLOAD/'Motion Stage.m3u').write_text(playlist)
 print('REPORT',ROOT/'reports'/'track-audio.json',flush=True)
 sys.exit(0 if all(e['status']=='ready' for e in results) else 1)
