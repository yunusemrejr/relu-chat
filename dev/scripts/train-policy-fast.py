#!/usr/bin/env python3
"""CPU-only contextual-bandit policy training, with runtime-equivalent export.
One question is one episode. Actions select mode, intent, counts and tone.
Reward is routing-label agreement, NOT a claim of user satisfaction or factuality.
Uses fresh on-policy REINFORCE samples and an exact action-independent baseline.
"""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
os.environ['MKL_NUM_THREADS']='1'
import argparse, copy, hashlib, json, time
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--max-seconds',type=float,default=120);p.add_argument('--seed',type=int,default=20260909);args=p.parse_args()
if not 5<=args.max_seconds<=540: p.error('--max-seconds must be between 5 and 540 (10-minute total budget)')
start=time.monotonic();deadline=start+args.max_seconds;rng=np.random.default_rng(args.seed)
root=Path(__file__).resolve().parents[2];out=root/'dev/exports/fast-policy';out.mkdir(parents=True,exist_ok=True)
source=(root/'dev/datasets/policy-runtime-v2.json').read_bytes();dataset=json.loads(source);rows=dataset['rows']
heads={'mode':5,'intent':5,'topic_count':4,'frag_count':4,'tone':4}
scale=np.ones(25,dtype=np.float32);scale[[2,10,12,18,22,23]]=[3,8,32,22,4,5]
def get_split(split):
 rs=[r for r in rows if r['split']==split]
 return rs,np.array([r['x'] for r in rs],dtype=np.float32),{h:np.array([r['targets'][h] for r in rs]) for h in heads}
train,raw_x,train_y=get_split('train');val,vraw,vy=get_split('validation');test,traw,ty=get_split('test')
x=raw_x/scale;vx=vraw/scale;tx=traw/scale
# Oversample rare off-topic episodes without leaking validation/test data.
indices=np.concatenate([np.arange(len(x)),np.tile(np.flatnonzero(train_y['mode']==1),12)])
params={}
for name,n,m in [('fc1',25,128),('fc2',128,64),*[(h+'_head',64,k) for h,k in heads.items()]]:
 params[name+'.weight']=(rng.standard_normal((m,n))*np.sqrt(2/n)*(.1 if name.endswith('_head') else 1)).astype(np.float32)
 params[name+'.bias']=np.zeros(m,dtype=np.float32)
params['creativity_head.weight']=np.zeros((1,64),dtype=np.float32);params['creativity_head.bias']=np.array([-2.1972246],dtype=np.float32)
mom={k:np.zeros_like(v) for k,v in params.items()};var=copy.deepcopy(mom);step=0

def forward(w,features):
 h1=np.maximum(features@w['fc1.weight'].T+w['fc1.bias'],0)
 h2=np.maximum(h1@w['fc2.weight'].T+w['fc2.bias'],0)
 probs={}
 for h in heads:
  z=h2@w[h+'_head.weight'].T+w[h+'_head.bias'];z-=z.max(axis=1,keepdims=True);e=np.exp(z);probs[h]=e/e.sum(axis=1,keepdims=True)
 return h1,h2,probs

def evaluate(w,features,labels):
 _,_,probs=forward(w,features);mask=labels['mode']!=1
 metrics={h:float(np.mean(probs[h].argmax(1)[mask if h!='mode' else slice(None)]==labels[h][mask if h!='mode' else slice(None)])) for h in heads}
 metrics['joint_mode_intent']=float(np.mean((probs['mode'].argmax(1)==labels['mode']) & ((probs['intent'].argmax(1)==labels['intent']) | ~mask)))
 metrics['score']=.4*metrics['mode']+.4*metrics['intent']+.1*metrics['topic_count']+.1*metrics['frag_count']
 return metrics

def update(batch,phase):
 global step
 features=x[batch].copy();labels={h:y[batch] for h,y in train_y.items()};n=len(batch)
 # Modest retrieval-score jitter trains robustness to keyword/dense calibration.
 features[:,[0,1,9,17]]=np.clip(features[:,[0,1,9,17]]+rng.normal(0,.025,(n,4)),0,1)
 h1,h2,probs=forward(params,features);grad={};dh2=np.zeros_like(h2);reward_sum=0
 mask=(labels['mode']!=1).astype(np.float32)
 for head,prob in probs.items():
  target=labels[head];weight=2.0 if head=='mode' else 1.5 if head=='intent' else .35
  active=np.ones(n,dtype=np.float32) if head=='mode' else mask
  supervision=prob.copy();supervision[np.arange(n),target]-=1
  if phase=='rl':
   actions=(rng.random(n)[:,None]>np.cumsum(prob,axis=1)).sum(axis=1).clip(0,prob.shape[1]-1)
   reward=np.where(actions==target,1.,-.5).astype(np.float32)
   baseline=1.5*prob[np.arange(n),target]-.5
   dlog=prob.copy();dlog[np.arange(n),actions]-=1
   derivative=dlog*(reward-baseline)[:,None]+.15*supervision
   # Entropy bonus encourages continued exploration during fine-tuning.
   logs=np.log(np.clip(prob,1e-8,1));derivative+=.005*prob*(logs-(prob*logs).sum(1,keepdims=True))
   reward_sum+=float(np.mean(reward*active))*weight
  else: derivative=supervision
  derivative*=active[:,None]*weight/n
  name=head+'_head';grad[name+'.weight']=derivative.T@h2;grad[name+'.bias']=derivative.sum(0)
  dh2+=derivative@params[name+'.weight']
 dz2=dh2*(h2>0);grad['fc2.weight']=dz2.T@h1;grad['fc2.bias']=dz2.sum(0)
 dz1=(dz2@params['fc2.weight'])*(h1>0);grad['fc1.weight']=dz1.T@features;grad['fc1.bias']=dz1.sum(0)
 norm=np.sqrt(sum(float(np.sum(g*g)) for g in grad.values()));clip=min(1.,2./max(norm,1e-8));step+=1
 rate=.0015 if phase=='supervised' else .00015
 for key,g in grad.items():
  g=g*clip+1e-5*params[key];mom[key]=.9*mom[key]+.1*g;var[key]=.999*var[key]+.001*g*g
  params[key]-=rate*(mom[key]/(1-.9**step))/(np.sqrt(var[key]/(1-.999**step))+1e-8)
 return reward_sum

baseline_payload=json.loads((root/'dev/benchmarks/baselines/policy-2026-05.json').read_text());baseline={k:np.asarray(v,dtype=np.float32) for k,v in baseline_payload.get('weights',baseline_payload).items() if isinstance(v,list)}
baseline_test=evaluate(baseline,traw,ty)
best=None;history=[];rl_updates=0
for phase,epochs in [('supervised',100),('rl',90)]:
 phase_best=-1.;phase_weights=None
 for epoch in range(epochs):
  if time.monotonic()>deadline:break
  order=rng.permutation(indices);rewards=[]
  for offset in range(0,len(order),128):
   if time.monotonic()>deadline:break
   rewards.append(update(order[offset:offset+128],phase))
   if phase=='rl':rl_updates+=1
  score=evaluate(params,vx,vy)
  if score['score']>phase_best:phase_best=score['score'];phase_weights=copy.deepcopy(params)
  if epoch%10==0:
   record={'phase':phase,'epoch':epoch,'seconds':round(time.monotonic()-start,2),'validation':score,'sampled_reward':float(np.mean(rewards)) if rewards else 0};history.append(record);print(json.dumps(record),flush=True)
 # Start RL at the strongest supervised checkpoint. For RL pick only RL checkpoints.
 if phase_weights is not None:params=phase_weights
 if phase=='supervised':supervised=copy.deepcopy(params);supervised_test=evaluate(supervised,tx,ty);supervised_val=evaluate(supervised,vx,vy)
 if phase=='rl':best=copy.deepcopy(params)
if rl_updates==0:raise SystemExit('No RL updates completed; no production model written.')
rl_test=evaluate(best,tx,ty);rl_val=evaluate(best,vx,vy)
# Gate selection using validation only. Test is used once for release acceptance.
gate=rl_val['score']>=supervised_val['score']-.015 and rl_test['joint_mode_intent']>=baseline_test['joint_mode_intent'] and rl_test['mode']>=.88 and rl_test['intent']>=.9
export=copy.deepcopy(best);export['fc1.weight']=export['fc1.weight']/scale[None,:]
weights={k:np.round(v,7).tolist() for k,v in export.items()};weights['_version']=3
payload={'weights':weights,'training':{'method':'supervised warm start + on-policy contextual-bandit REINFORCE','seed':args.seed,'runtime':'25→128 ReLU→64 ReLU; no LayerNorm','dataset_sha256':hashlib.sha256(source).hexdigest()}}
(out/'policy.weights.json').write_text(json.dumps(payload,separators=(',',':'))+'\n')
# Cross-language fixture evaluates exported raw-input weights, including float rounding.
fixture={k:np.asarray(v,dtype=np.float32) for k,v in weights.items() if isinstance(v,list)}
fixtures=[]
for i in range(min(40,len(test))):
 _,_,probs=forward(fixture,traw[i:i+1]);fixtures.append({'x':traw[i].tolist(),'probs':{h:v[0].tolist() for h,v in probs.items()}})
(out/'parity-fixtures.json').write_text(json.dumps(fixtures))
report={'method':payload['training']['method'],'task':'One-step routing reward from authored labels; not end-to-end factuality or real-user feedback.','seed':args.seed,'dataset_sha256':hashlib.sha256(source).hexdigest(),'training_seconds':round(time.monotonic()-start,3),'max_training_seconds':args.max_seconds,'rl_updates':rl_updates,'parameters':sum(v.size for v in export.values()),'split_counts':{'train':len(train),'validation':len(val),'test':len(test)},'split_protocol':'Topics disjoint across all three splits; training templates differ from validation/test templates. Authored cases, no user conversations. Validation selects checkpoint; test gates release.','old_policy_test':baseline_test,'supervised_test':supervised_test,'reinforce_test':rl_test,'validation':rl_val,'release_gate_passed':gate,'history':history}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='history'},indent=2))
if not gate:raise SystemExit('Release gate failed; candidate retained for inspection only.')
