#!/usr/bin/env python3
"""
Fragment Metadata Generator & Enrichment Tool for ReLU.chat
===========================================================

Generates fragment-meta.json with auto-annotated metadata for all three bots,
and enriches undersized application fragments in knowledge bases.

Usage:
  # Generate fragment-meta.json for game-theory-chat
  python3 dev/scripts/enrich-fragments.py --bot game-theory --generate-meta

  # Generate fragment-meta.json for golden-age-inquiry  
  python3 dev/scripts/enrich-fragments.py --bot golden-age --generate-meta

  # Enrich app fragments (with dry-run to preview)
  python3 dev/scripts/enrich-fragments.py --bot game-theory --enrich --type app --min-words 20 --dry-run
  python3 dev/scripts/enrich-fragments.py --bot game-theory --enrich --type app --min-words 20
"""

import json, sys, os, argparse, re
from collections import OrderedDict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the parser
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'dev', 'scripts'))
from parse_kb import parse_kb_file

# ============================================================================
# 1. METADATA GENERATION
# ============================================================================

def count_words(text):
    return len(text.split())

def classify_style(fragment_type):
    mapping = {'def': 'formal', 'int': 'intuitive', 'ex': 'example', 'form': 'proof', 'app': 'intuitive'}
    return mapping.get(fragment_type, 'intuitive')

def classify_creativity(style):
    return {'formal': 0.05, 'example': 0.15, 'proof': 0.10, 'intuitive': 0.30, 'analogy': 0.25}.get(style, 0.15)

# -- Game Theory classifications --

GT_TRUTH = {
    # Well-known, rigorously proven concepts
    0.95: [
        'nash_eq', 'prisoners_dilemma', 'dom_strat', 'mixed_strat', 'pure_strat',
        'zero_sum', 'minimax', 'extensive_form', 'normal_form', 'bayesian_game',
        'repeated_game', 'cournot', 'bertrand', 'auction_theory', 'vickrey',
        'mech_design', 'revelation', 'shapley', 'core', 'nash_bargaining',
        'rubinstein', 'corr_eq', 'spe', 'battle_of_sexes', 'matching_pennies',
        'ultimatum', 'centipede', 'folk', 'tft', 'backward_induction', 'ied',
        'rationalizability', 'common_knowledge', 'pareto', 'stackelberg',
        'hawk_dove', 'stag_hunt', 'chicken', 'public_goods', 'tragedy_commons',
        'potential', 'congestion', 'poa', 'zermelo', 'price_of_stability',
        'harsanyi', 'wardrop', 'core_selection', 'fair_division',
        'voting_theory', 'social_choice', 'banzhaf', 'evo_gt', 'ess', 'replicator',
        'pbe', 'signaling', 'screening', 'principal_agent', 'no_regret',
        'fictitious_play', 'coop_game', 'noncoop_game', 'algo_mech_design',
        'quantal_response', 'level_k', 'cheap_talk', 'supermodular'
    ],
    # Advanced/specialized — well-known but with ongoing research debate
    0.85: [
        'trembling', 'sequential_eq', 'proper_eq', 'global_games',
        'smoothed_poa', 'mean_field', 'berge_eq', 'evol_stable_sets'
    ],
    # Niche/speculative concepts — less established
    0.70: []
}

GT_DIFFICULTY = {
    4: ['berge_eq', 'evol_stable_sets', 'smoothed_poa', 'mean_field', 'proper_eq'],
    3: ['trembling', 'sequential_eq', 'pbe', 'bayesian_game', 'mech_design',
        'principal_agent', 'signaling', 'screening', 'harsanyi', 'corr_eq',
        'no_regret', 'fictitious_play', 'quantal_response', 'level_k',
        'cheap_talk', 'supermodular', 'algo_mech_design', 'folk', 'revelation',
        'fair_division', 'voting_theory', 'social_choice', 'banzhaf',
        'price_of_stability', 'wardrop', 'rationalizability', 'common_knowledge',
        'global_games', 'coop_game', 'core', 'shapley', 'coalition',
        'nash_bargaining', 'rubinstein', 'repeated_game', 'spe',
        'backward_induction', 'ied', 'centipede', 'ultimatum', 'ess',
        'replicator', 'evo_gt', 'hawk_dove', 'congestion', 'poa', 'potential',
        'zermelo', 'mixed_strat', 'extensive_form', 'stackelberg',
        'auction_theory', 'vickrey', 'noncoop_game', 'matching_pennies',
        'public_goods', 'tragedy_commons', 'signaling', 'screening',
        'principal_agent', 'cheap_talk',
    ],
    2: ['dom_strat', 'pure_strat', 'zero_sum', 'minimax', 'normal_form',
        'battle_of_sexes', 'stag_hunt', 'chicken', 'tft', 'bertrand',
        'cournot', 'pareto', 'revelation', 'core_selection'],
    1: ['nash_eq', 'prisoners_dilemma'],
}

GT_PREREQS = {
    'nash_eq': ['prisoners_dilemma'],
    'prisoners_dilemma': [],
    'dom_strat': ['prisoners_dilemma', 'nash_eq'],
    'mixed_strat': ['nash_eq', 'pure_strat'],
    'pure_strat': ['nash_eq'],
    'zero_sum': ['nash_eq', 'minimax'],
    'coop_game': ['nash_eq'],
    'noncoop_game': ['nash_eq'],
    'minimax': ['zero_sum', 'nash_eq'],
    'extensive_form': ['normal_form', 'nash_eq'],
    'normal_form': ['nash_eq'],
    'bayesian_game': ['nash_eq'],
    'repeated_game': ['prisoners_dilemma', 'nash_eq'],
    'evo_gt': ['nash_eq'],
    'ess': ['evo_gt', 'nash_eq'],
    'replicator': ['evo_gt', 'ess'],
    'stackelberg': ['cournot', 'spe'],
    'cournot': ['nash_eq'],
    'bertrand': ['nash_eq', 'cournot'],
    'auction_theory': ['bayesian_game', 'mech_design'],
    'vickrey': ['auction_theory', 'dom_strat'],
    'mech_design': ['bayesian_game'],
    'revelation': ['mech_design', 'bayesian_game'],
    'shapley': ['coop_game'],
    'core': ['coop_game'],
    'coalition': ['coop_game', 'core'],
    'nash_bargaining': ['coop_game', 'nash_eq'],
    'rubinstein': ['nash_bargaining', 'spe'],
    'corr_eq': ['nash_eq'],
    'spe': ['nash_eq', 'extensive_form'],
    'pbe': ['spe', 'bayesian_game'],
    'trembling': ['nash_eq', 'spe'],
    'battle_of_sexes': ['nash_eq'],
    'hawk_dove': ['ess', 'evo_gt'],
    'stag_hunt': ['nash_eq'],
    'chicken': ['nash_eq'],
    'matching_pennies': ['zero_sum', 'mixed_strat'],
    'ultimatum': ['spe', 'nash_eq'],
    'centipede': ['spe', 'backward_induction'],
    'public_goods': ['prisoners_dilemma', 'nash_eq'],
    'tragedy_commons': ['public_goods', 'nash_eq'],
    'signaling': ['pbe', 'bayesian_game'],
    'screening': ['signaling', 'bayesian_game'],
    'principal_agent': ['screening', 'bayesian_game'],
    'folk': ['repeated_game', 'spe'],
    'tft': ['repeated_game', 'prisoners_dilemma'],
    'backward_induction': ['spe', 'extensive_form'],
    'ied': ['dom_strat', 'nash_eq'],
    'rationalizability': ['ied', 'nash_eq'],
    'common_knowledge': ['bayesian_game', 'rationalizability'],
    'potential': ['nash_eq', 'congestion'],
    'congestion': ['potential', 'nash_eq'],
    'poa': ['nash_eq', 'congestion'],
    'zermelo': ['backward_induction', 'extensive_form'],
    'harsanyi': ['bayesian_game'],
    'pareto': ['nash_eq'],
    'sequential_eq': ['pbe', 'spe'],
    'proper_eq': ['trembling', 'nash_eq'],
    'quantal_response': ['nash_eq'],
    'level_k': ['ied', 'nash_eq'],
    'global_games': ['supermodular', 'bayesian_game'],
    'supermodular': ['nash_eq'],
    'wardrop': ['congestion', 'poa'],
    'price_of_stability': ['poa', 'nash_eq'],
    'smoothed_poa': ['poa', 'wardrop'],
    'no_regret': ['corr_eq', 'nash_eq'],
    'fictitious_play': ['no_regret', 'nash_eq'],
    'evol_stable_sets': ['ess', 'evo_gt'],
    'cheap_talk': ['signaling', 'pbe'],
    'berge_eq': ['nash_eq', 'coop_game'],
    'mean_field': ['nash_eq'],
    'algo_mech_design': ['mech_design', 'auction_theory'],
    'fair_division': ['coop_game', 'shapley'],
    'voting_theory': ['social_choice', 'mech_design'],
    'social_choice': ['voting_theory', 'pareto'],
    'banzhaf': ['coalition', 'core'],
    'core_selection': ['core', 'coalition'],
}

def gt_truth(topic_id):
    for val, ids in GT_TRUTH.items():
        if topic_id in ids:
            return val
    return 0.90

def gt_difficulty(topic_id, ftype):
    for val, ids in GT_DIFFICULTY.items():
        if topic_id in ids:
            base = val
            break
    else:
        base = 2
    
    if ftype == 'form' and base < 4:
        base = min(4, base + 1)
    elif ftype == 'int' and base > 0:
        base = max(0, base - 1)
    return base

def gt_prereqs(topic_id):
    return GT_PREREQS.get(topic_id, [])

# -- Golden Age classifications --

GA_TRUTH = {
    0.95: [
        'al_khwarizmi', 'ibn_sina', 'al_kindi', 'ibn_al_haytham',
        'al_razI', 'ibn_rushd', 'al_ghazali', 'ibn_khaldun',
        'al_battani', 'al_biruni', 'omar_khayyam', 'al_farabi',
        'house_of_wisdom', 'canon_of_medicine', 'translation_movement',
        'astronomy', 'astrolabe', 'algebra', 'algebra_development',
        'medicine_golden_age', 'optics', 'paper_making',
        'al_jazari', 'banu_musa', 'maragha_school',
        'nasir_al_din_tusi', 'ulugh_beg', 'al_idrisi',
        'hunayn_ibn_ishaq', 'al_zahrawi', 'ibn_al_nafis',
        'al_zarqali', 'al_farghani', 'philosophy_golden_age',
        'ibn_tufayl', 'ibn_bajjah', 'al_karaji', 'al_samawal',
        'thabit_ibn_qurra', 'ibn_al_shatir', 'qusta_ibn_luqa',
        'al_majriti', 'ibn_sahl'
    ],
    0.85: [
        'abbas_ibn_firnas',
    ],
    0.75: [
        'fatima_al_fihri', 'lubana', 'mariam_al_astrulabi'
    ]
}

GA_DIFFICULTY = {
    3: ['ibn_sina', 'ibn_sahl', 'thabit_ibn_qurra', 'al_samawal',
        'ibn_al_shatir', 'ibn_bajjah', 'al_ghazali', 'ibn_khaldun'],
    2: ['al_khwarizmi', 'algebra', 'al_kindi', 'ibn_al_haytham',
        'optics', 'al_razI', 'astronomy', 'algebra_development',
        'maragha_school', 'nasir_al_din_tusi', 'al_farghani',
        'al_battani', 'al_biruni', 'omar_khayyam', 'al_zarqali',
        'al_farabi', 'philosophy_golden_age', 'ibn_rushd',
        'ibn_tufayl', 'al_jazari', 'al_karaji', 'qusta_ibn_luqa'],
    1: ['house_of_wisdom', 'canon_of_medicine', 'translation_movement',
        'astrolabe', 'paper_making', 'medicine_golden_age',
        'al_zahrawi', 'ibn_al_nafis', 'ulugh_beg', 'hunayn_ibn_ishaq',
        'al_idrisi', 'al_majriti', 'fatima_al_fihri',
        'mariam_al_astrulabi', 'lubana', 'abbas_ibn_firnas',
        'banu_musa']
}

GA_PREREQS = {
    'house_of_wisdom': ['translation_movement'],
    'al_khwarizmi': ['house_of_wisdom'],
    'algebra': ['al_khwarizmi'],
    'al_kindi': ['house_of_wisdom', 'translation_movement'],
    'ibn_sina': ['al_kindi', 'al_razI'],
    'canon_of_medicine': ['ibn_sina'],
    'ibn_al_haytham': ['al_kindi'],
    'optics': ['ibn_al_haytham'],
    'translation_movement': ['house_of_wisdom'],
    'al_razI': [],
    'astrolabe': ['astronomy'],
    'astronomy': ['al_khwarizmi'],
    'algebra_development': ['algebra', 'al_khwarizmi'],
    'maragha_school': ['astronomy', 'nasir_al_din_tusi'],
    'paper_making': [],
    'ibn_rushd': ['ibn_sina', 'al_farabi'],
    'al_ghazali': ['ibn_sina', 'al_farabi'],
    'medicine_golden_age': ['ibn_sina', 'al_razI', 'canon_of_medicine'],
    'al_biruni': ['al_khwarizmi'],
    'al_zahrawi': ['medicine_golden_age'],
    'ibn_al_nafis': ['ibn_sina', 'medicine_golden_age'],
    'philosophy_golden_age': ['al_kindi', 'al_farabi'],
    'al_farabi': ['al_kindi'],
    'omar_khayyam': ['algebra_development', 'al_khwarizmi'],
    'al_zarqali': ['astrolabe', 'astronomy'],
    'nasir_al_din_tusi': ['astronomy', 'maragha_school'],
    'ibn_al_shatir': ['maragha_school', 'nasir_al_din_tusi'],
    'ulugh_beg': ['astronomy', 'maragha_school'],
    'al_battani': ['astronomy'],
    'hunayn_ibn_ishaq': ['translation_movement', 'house_of_wisdom'],
    'al_idrisi': ['astronomy'],
    'ibn_khaldun': ['philosophy_golden_age'],
    'al_jazari': ['banu_musa'],
    'banu_musa': ['house_of_wisdom'],
    'thabit_ibn_qurra': ['translation_movement', 'al_khwarizmi'],
    'al_karaji': ['algebra_development', 'al_khwarizmi'],
    'al_samawal': ['al_karaji', 'algebra_development'],
    'ibn_sahl': ['optics', 'ibn_al_haytham'],
    'al_farghani': ['astronomy'],
    'qusta_ibn_luqa': ['translation_movement', 'hunayn_ibn_ishaq'],
    'al_majriti': ['astrolabe', 'astronomy'],
    'fatima_al_fihri': ['paper_making'],
    'mariam_al_astrulabi': ['astrolabe', 'astronomy'],
    'lubana': ['paper_making'],
    'abbas_ibn_firnas': ['al_majriti', 'astronomy'],
    'ibn_bajjah': ['philosophy_golden_age', 'al_farabi'],
    'ibn_tufayl': ['ibn_bajjah', 'philosophy_golden_age'],
}

def ga_truth(topic_id):
    for val, ids in GA_TRUTH.items():
        if topic_id in ids:
            return val
    return 0.85

def ga_difficulty(topic_id, ftype):
    for val, ids in GA_DIFFICULTY.items():
        if topic_id in ids:
            base = val
            break
    else:
        base = 2
    
    if ftype == 'form' and base < 3:
        base = min(3, base + 1)
    elif ftype == 'int' and base > 0:
        base = max(0, base - 1)
    return base

def ga_prereqs(topic_id):
    return GA_PREREQS.get(topic_id, [])

def generate_meta(bot_name, topics):
    """Generate fragment-meta.json structure."""
    result = OrderedDict()
    
    for topic in topics:
        entry_id = topic['id']
        entry = OrderedDict()
        entry['entry_id'] = entry_id
        entry['name'] = topic['name']
        entry['summary'] = topic['summary']
        entry['related'] = topic.get('related', [])
        
        fragments = OrderedDict()
        
        for ftype in ['def', 'int', 'ex', 'form', 'app']:
            frag_list = []
            for idx, text in enumerate(topic['fragments'].get(ftype, [])):
                frag_id = f"frag_{entry_id}_{ftype}_{idx + 1:03d}"
                wc = count_words(text)
                style = classify_style(ftype)
                creativity = classify_creativity(style)
                
                if bot_name == 'game-theory-chat':
                    truth = gt_truth(entry_id)
                    difficulty = gt_difficulty(entry_id, ftype)
                    requires = gt_prereqs(entry_id)
                else:
                    truth = ga_truth(entry_id)
                    difficulty = ga_difficulty(entry_id, ftype)
                    requires = ga_prereqs(entry_id)
                
                source_conf = min(0.95, truth + 0.0)
                
                meta = OrderedDict([
                    ('truth_confidence', truth),
                    ('difficulty', difficulty),
                    ('style', style),
                    ('creativity', creativity),
                    ('requires', requires),
                    ('avoid_with', []),
                    ('compatible_with', []),
                    ('source_confidence', source_conf),
                    ('length_tokens', wc)
                ])
                
                frag_entry = OrderedDict([
                    ('id', frag_id),
                    ('text', text),
                    ('meta', meta)
                ])
                frag_list.append(frag_entry)
            
            fragments[ftype] = frag_list
        
        entry['fragments'] = fragments
        result[entry_id] = entry
    
    return result

# ============================================================================
# 2. ENRICHMENT ENGINE
# ============================================================================

ENRICHED_APPS = {
    'public_goods': [
        "Climate change mitigation is the canonical public-goods problem: each country benefits from global emission reductions but has incentives to free-ride on others' efforts. International agreements like the Paris Accord attempt to coordinate contributions.",
        "Open-source software development exemplifies voluntary public-goods provision: developers contribute code that everyone can use, facing a temptation to free-ride while hoping others will maintain the project."
    ],
    'poa': [
        "Internet routing protocols like BGP let autonomous systems choose paths selfishly. The Price of Anarchy quantifies how much slower traffic becomes compared to an optimally coordinated routing scheme, guiding network design and traffic engineering.",
        "In electricity markets, generators bid independently to maximize profit. The Price of Anarchy measures the efficiency loss from decentralized bidding relative to a centrally planned dispatch, informing market regulation and capacity planning."
    ],
    'potential': [
        "Distributed sensor networks use potential-game formulations to coordinate channel selection: each sensor's local decision to switch channels corresponds to climbing the potential function, guaranteeing convergence to interference-minimizing configurations.",
        "In cognitive radio networks, secondary users opportunistically access spectrum bands. The potential-game structure ensures that decentralized learning algorithms converge to efficient spectrum-sharing equilibria without central coordination."
    ],
    'chicken': [
        "The 1962 Cuban Missile Crisis is the definitive Chicken game: the US and USSR each preferred the other to back down, but mutual escalation meant nuclear war. Kennedy's naval blockade was a calibrated move short of full, irreversible commitment.",
        "In labor disputes, both union and management may threaten a strike or lockout — each hoping the other will concede first. The risk is that both hold firm and the resulting work stoppage hurts everyone, just like a crash in Chicken."
    ],
    'tragedy_commons': [
        "Global fisheries exemplify the tragedy of the commons: each fishing nation maximizes its own catch, but the aggregate harvest depletes fish stocks below sustainable levels. The UN Law of the Sea and catch-share systems attempt to internalize this externality.",
        "Groundwater extraction by farmers illustrates the commons dilemma: each farmer drills deeper to secure water, but collective overpumping lowers the water table for all. California's Sustainable Groundwater Management Act mandates coordinated usage plans."
    ],
    'normal_form': [
        "The normal form is the default representation for computing Nash equilibria algorithmically: the Lemke-Howson algorithm operates directly on bimatrix payoff tables. Most introductory game theory textbooks use normal-form analysis as their starting point.",
        "In mechanism design, the designer first specifies the normal form — strategy spaces and payoff functions — before analyzing what equilibrium emerges. This abstraction underlies auction design, voting rule analysis, and contract theory."
    ],
    'bayesian_game': [
        "Online advertising platforms run Bayesian auctions daily: each advertiser has a private value for a click, drawn from a distribution the platform estimates. The generalized second-price auction is analyzed as a Bayesian game of incomplete information.",
        "In insurance markets, adverse selection creates a Bayesian game: buyers know their own risk type but insurers only know the population distribution. Rothschild-Stiglitz screening models analyze equilibrium contract menus under this information asymmetry."
    ],
    'cournot': [
        "The OPEC oil cartel's production decisions approximate Cournot competition among member nations. Each country chooses its output quantity knowing that aggregate supply affects the world oil price, and the model predicts how production quotas affect prices.",
        "In the global semiconductor industry, major manufacturers like TSMC, Samsung, and Intel engage in quantity competition: each decides fab capacity independently, and the total installed capacity determines chip prices in downstream markets worldwide."
    ],
    'battle_of_sexes': [
        "The VHS versus Betamax format war of the 1980s was a Battle of the Sexes: both Sony (Betamax) and JVC (VHS) preferred different standards, but consumers desperately needed a single coordinated outcome. VHS won despite Betamax's technical superiority.",
        "The choice between iOS and Android for app developers is a Battle of the Sexes: developers prefer the platform with more users, and users prefer the platform with more apps. Network effects lock in coordination on whichever platform gains initial momentum."
    ],
    'stag_hunt': [
        "The European Union's common currency is a Stag Hunt: all member states benefit from a stable euro (hunting the stag), but during crises, individual countries are tempted to pursue independent monetary policies (hunting the hare), risking currency union collapse.",
        "Joint military alliances like NATO are Stag Hunt games: collective defense yields the highest payoff (stag), but each member faces the temptation to reduce defense spending (hare) while relying on allies' contributions — threatening alliance credibility."
    ],
}

def enrich_kb_file(filepath, fragment_type='app', min_words=20, dry_run=False):
    """Read a knowledge-base.js, enrich short fragments of given type, write back."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    topics = parse_kb_file(filepath)
    enrichment_ids = list(ENRICHED_APPS.keys())
    
    modified_content = content
    changes = []
    enriched_count = 0
    
    for topic in topics:
        tid = topic['id']
        if tid not in enrichment_ids:
            continue
        
        enrich_texts = ENRICHED_APPS[tid]
        app_frags = topic['fragments'].get(fragment_type, [])
        
        if not app_frags:
            continue
        
        # Check if enrichment is needed
        needs_enrichment = False
        for t in app_frags:
            if count_words(t) < min_words:
                needs_enrichment = True
                break
        
        if not needs_enrichment:
            avg_wc = sum(count_words(t) for t in app_frags) / len(app_frags)
            if avg_wc >= min_words:
                continue
        
        # Replace each fragment
        for i, orig_text in enumerate(app_frags):
            if i >= len(enrich_texts):
                break
            
            wc_old = count_words(orig_text)
            if wc_old >= min_words:
                continue
            
            new_text = enrich_texts[i]
            wc_new = count_words(new_text)
            
            # Escape apostrophes for JS single-quoted strings
            # In JS single-quoted strings, apostrophes must be escaped as \'
            new_text_js = new_text.replace("'", "\\'")
            
            # Find and replace in content
            # Strategy: locate the topic by id, then find its app array
            topic_pattern = f"kb('{tid}'"
            topic_start = modified_content.find(topic_pattern)
            if topic_start < 0:
                continue
            
            # Find the app array within this topic
            search_region = modified_content[topic_start:topic_start + 3000]
            app_match = re.search(r"app\s*:\s*\[", search_region)
            if not app_match:
                continue
            
            app_start = topic_start + app_match.start()
            app_region = modified_content[app_start:app_start + 2000]
            
            # Find exact original text
            orig_pos = app_region.find(orig_text)
            if orig_pos < 0:
                continue
            
            abs_pos = app_start + orig_pos
            
            # Do the replacement
            # In the JS file, fragment is: 'original text'
            # We need to replace: 'original text' -> 'new text'
            # Find the enclosing quotes
            quote_start = abs_pos - 1  # opening quote
            quote_end = abs_pos + len(orig_text) + 1  # closing quote
            
            new_fragment = f"'{new_text_js}'"
            modified_content = (
                modified_content[:quote_start] +
                new_fragment +
                modified_content[quote_end:]
            )
            
            changes.append({
                'topic': tid,
                'index': i,
                'old_words': wc_old,
                'new_words': wc_new,
                'old_text': orig_text[:80] + ('...' if len(orig_text) > 80 else ''),
                'new_text': new_text[:80] + ('...' if len(new_text) > 80 else '')
            })
            enriched_count += 1
    
    if dry_run:
        print(f"\nDRY RUN: Would modify {enriched_count} fragments in {os.path.basename(filepath)}")
        for ch in changes:
            print(f"  [{ch['topic']}#{ch['index']}] {ch['old_words']}w -> {ch['new_words']}w")
            print(f"    Old: {ch['old_text']}")
            print(f"    New: {ch['new_text']}")
    elif modified_content != content:
        with open(filepath, 'w') as f:
            f.write(modified_content)
        print(f"\nEnriched {enriched_count} fragments in {os.path.basename(filepath)}")
        for ch in changes:
            print(f"  [{ch['topic']}#{ch['index']}] {ch['old_words']}w -> {ch['new_words']}w")
    else:
        print(f"\nNo fragments needed enrichment in {os.path.basename(filepath)}")
    
    return enriched_count

# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Fragment metadata generator and enrichment tool')
    parser.add_argument('--bot', choices=['game-theory', 'golden-age', 'data-science'],
                        default='game-theory', help='Bot to process')
    parser.add_argument('--generate-meta', action='store_true',
                        help='Generate fragment-meta.json')
    parser.add_argument('--enrich', action='store_true',
                        help='Enrich short fragments in knowledge base')
    parser.add_argument('--type', default='app',
                        help='Fragment type to enrich (default: app)')
    parser.add_argument('--min-words', type=int, default=20,
                        help='Minimum word count threshold (default: 20)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print changes without modifying files')
    
    args = parser.parse_args()
    
    bot_map = {
        'game-theory': 'game-theory-chat',
        'golden-age': 'golden-age-inquiry',
        'data-science': 'data-science-chat',
    }
    bot_name = bot_map[args.bot]
    
    kb_path = os.path.join(PROJECT_ROOT, 'chat', bot_name, 'js', 'knowledge-base.js')
    meta_path = os.path.join(PROJECT_ROOT, 'data', 'bots', bot_name, 'fragment-meta.json')
    
    if not os.path.exists(kb_path):
        print(f"Error: knowledge base not found at {kb_path}")
        sys.exit(1)
    
    if args.generate_meta:
        print(f"Parsing {kb_path}...")
        topics = parse_kb_file(kb_path)
        print(f"Found {len(topics)} topics")
        
        meta = generate_meta(bot_name, topics)
        
        os.makedirs(os.path.dirname(meta_path), exist_ok=True)
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
        
        print(f"Generated fragment-meta.json with {len(meta)} entries at {meta_path}")
        
        # Statistics
        total_frags = sum(
            len(frags) for entry in meta.values()
            for frags in entry['fragments'].values()
        )
        print(f"  Total fragments: {total_frags}")
        
        type_stats = {'def': [], 'int': [], 'ex': [], 'form': [], 'app': []}
        for entry in meta.values():
            for ftype, frags in entry['fragments'].items():
                for frag in frags:
                    type_stats[ftype].append(frag['meta']['length_tokens'])
        
        for ftype in ['def', 'int', 'ex', 'form', 'app']:
            counts = type_stats[ftype]
            if counts:
                avg = sum(counts) / len(counts)
                mn = min(counts)
                mx = max(counts)
                print(f"  {ftype}: {len(counts)} fragments, avg {avg:.1f}w, range [{mn}-{mx}]")
    
    if args.enrich:
        print(f"Processing {kb_path}...")
        count = enrich_kb_file(kb_path, args.type, args.min_words, args.dry_run)

if __name__ == '__main__':
    main()
