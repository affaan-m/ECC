#!/usr/bin/env python3
"""
Instinct CLI - Manage instincts for Continuous Learning v2

Commands:
  status   - Show all instincts and their status
  import   - Import instincts from file or URL
  export   - Export instincts to file
  evolve   - Cluster instincts into skills/commands/agents
"""

import argparse
import json
import os
import sys
import re
import urllib.request
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

HOMUNCULUS_DIR = Path.home() / ".claude" / "homunculus"
INSTINCTS_DIR = HOMUNCULUS_DIR / "instincts"
PERSONAL_DIR = INSTINCTS_DIR / "personal"
INHERITED_DIR = INSTINCTS_DIR / "inherited"
EVOLVED_DIR = HOMUNCULUS_DIR / "evolved"
OBSERVATIONS_FILE = HOMUNCULUS_DIR / "observations.jsonl"

# Ensure directories exist
for d in [PERSONAL_DIR, INHERITED_DIR, EVOLVED_DIR / "skills", EVOLVED_DIR / "commands", EVOLVED_DIR / "agents"]:
    d.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────
# Instinct Parser
# ─────────────────────────────────────────────

def parse_instinct_file(content: str) -> list[dict]:
    """Parse YAML-like instinct file format."""
    instincts = []
    current = {}
    in_frontmatter = False
    content_lines = []

    for line in content.split('\n'):
        if line.strip() == '---':
            if in_frontmatter:
                # End of frontmatter - content comes next, don't append yet
                in_frontmatter = False
            else:
                # Start of frontmatter
                in_frontmatter = True
                if current:
                    current['content'] = '\n'.join(content_lines).strip()
                    instincts.append(current)
                current = {}
                content_lines = []
        elif in_frontmatter:
            # Parse YAML-like frontmatter
            if ':' in line:
                key, value = line.split(':', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key == 'confidence':
                    current[key] = float(value)
                else:
                    current[key] = value
        else:
            content_lines.append(line)

    # Don't forget the last instinct
    if current:
        current['content'] = '\n'.join(content_lines).strip()
        instincts.append(current)

    return [i for i in instincts if i.get('id')]


def load_all_instincts() -> list[dict]:
    """Load all instincts from personal and inherited directories."""
    instincts = []

    for directory in [PERSONAL_DIR, INHERITED_DIR]:
        if not directory.exists():
            continue
        yaml_files = sorted(
            set(directory.glob("*.yaml"))
            | set(directory.glob("*.yml"))
            | set(directory.glob("*.md"))
        )
        for file in yaml_files:
            try:
                content = file.read_text(encoding="utf-8")
                parsed = parse_instinct_file(content)
                for inst in parsed:
                    inst['_source_file'] = str(file)
                    inst['_source_type'] = directory.name
                instincts.extend(parsed)
            except Exception as e:
                print(f"Warning: Failed to parse {file}: {e}", file=sys.stderr)

    return instincts


# ─────────────────────────────────────────────
# Status Command
# ─────────────────────────────────────────────

def cmd_status(args):
    """Show status of all instincts."""
    instincts = load_all_instincts()

    if not instincts:
        print("No instincts found.")
        print(f"\nInstinct directories:")
        print(f"  Personal:  {PERSONAL_DIR}")
        print(f"  Inherited: {INHERITED_DIR}")
        return

    # Group by domain
    by_domain = defaultdict(list)
    for inst in instincts:
        domain = inst.get('domain', 'general')
        by_domain[domain].append(inst)

    # Print header
    print(f"\n{'='*60}")
    print(f"  INSTINCT STATUS - {len(instincts)} total")
    print(f"{'='*60}\n")

    # Summary by source
    personal = [i for i in instincts if i.get('_source_type') == 'personal']
    inherited = [i for i in instincts if i.get('_source_type') == 'inherited']
    print(f"  Personal:  {len(personal)}")
    print(f"  Inherited: {len(inherited)}")
    print()

    # Print by domain
    for domain in sorted(by_domain.keys()):
        domain_instincts = by_domain[domain]
        print(f"## {domain.upper()} ({len(domain_instincts)})")
        print()

        for inst in sorted(domain_instincts, key=lambda x: -x.get('confidence', 0.5)):
            conf = inst.get('confidence', 0.5)
            conf_bar = '█' * int(conf * 10) + '░' * (10 - int(conf * 10))
            trigger = inst.get('trigger', 'unknown trigger')
            source = inst.get('source', 'unknown')

            print(f"  {conf_bar} {int(conf*100):3d}%  {inst.get('id', 'unnamed')}")
            print(f"            trigger: {trigger}")

            # Extract action from content
            content = inst.get('content', '')
            action_match = re.search(r'## Action\s*\n\s*(.+?)(?:\n\n|\n##|$)', content, re.DOTALL)
            if action_match:
                action = action_match.group(1).strip().split('\n')[0]
                print(f"            action: {action[:60]}{'...' if len(action) > 60 else ''}")

            print()

    # Observations stats
    if OBSERVATIONS_FILE.exists():
        obs_count = sum(1 for _ in open(OBSERVATIONS_FILE))
        print(f"─────────────────────────────────────────────────────────")
        print(f"  Observations: {obs_count} events logged")
        print(f"  File: {OBSERVATIONS_FILE}")

    print(f"\n{'='*60}\n")


# ─────────────────────────────────────────────
# Import Command
# ─────────────────────────────────────────────

def cmd_import(args):
    """Import instincts from file or URL."""
    source = args.source

    # Fetch content
    if source.startswith('http://') or source.startswith('https://'):
        print(f"Fetching from URL: {source}")
        try:
            with urllib.request.urlopen(source) as response:
                content = response.read().decode('utf-8')
        except Exception as e:
            print(f"Error fetching URL: {e}", file=sys.stderr)
            return 1
    else:
        path = Path(source).expanduser()
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            return 1
        content = path.read_text(encoding="utf-8")

    # Parse instincts
    new_instincts = parse_instinct_file(content)
    if not new_instincts:
        print("No valid instincts found in source.")
        return 1

    print(f"\nFound {len(new_instincts)} instincts to import.\n")

    # Load existing
    existing = load_all_instincts()
    existing_ids = {i.get('id') for i in existing}

    # Categorize
    to_add = []
    duplicates = []
    to_update = []

    for inst in new_instincts:
        inst_id = inst.get('id')
        if inst_id in existing_ids:
            # Check if we should update
            existing_inst = next((e for e in existing if e.get('id') == inst_id), None)
            if existing_inst:
                if inst.get('confidence', 0) > existing_inst.get('confidence', 0):
                    to_update.append(inst)
                else:
                    duplicates.append(inst)
        else:
            to_add.append(inst)

    # Filter by minimum confidence
    min_conf = args.min_confidence or 0.0
    to_add = [i for i in to_add if i.get('confidence', 0.5) >= min_conf]
    to_update = [i for i in to_update if i.get('confidence', 0.5) >= min_conf]

    # Display summary
    if to_add:
        print(f"NEW ({len(to_add)}):")
        for inst in to_add:
            print(f"  + {inst.get('id')} (confidence: {inst.get('confidence', 0.5):.2f})")

    if to_update:
        print(f"\nUPDATE ({len(to_update)}):")
        for inst in to_update:
            print(f"  ~ {inst.get('id')} (confidence: {inst.get('confidence', 0.5):.2f})")

    if duplicates:
        print(f"\nSKIP ({len(duplicates)} - already exists with equal/higher confidence):")
        for inst in duplicates[:5]:
            print(f"  - {inst.get('id')}")
        if len(duplicates) > 5:
            print(f"  ... and {len(duplicates) - 5} more")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        return 0

    if not to_add and not to_update:
        print("\nNothing to import.")
        return 0

    # Confirm
    if not args.force:
        response = input(f"\nImport {len(to_add)} new, update {len(to_update)}? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            return 0

    # Write to inherited directory
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    source_name = Path(source).stem if not source.startswith('http') else 'web-import'
    output_file = INHERITED_DIR / f"{source_name}-{timestamp}.yaml"

    all_to_write = to_add + to_update
    output_content = f"# Imported from {source}\n# Date: {datetime.now().isoformat()}\n\n"

    for inst in all_to_write:
        output_content += "---\n"
        output_content += f"id: {inst.get('id')}\n"
        output_content += f"trigger: \"{inst.get('trigger', 'unknown')}\"\n"
        output_content += f"confidence: {inst.get('confidence', 0.5)}\n"
        output_content += f"domain: {inst.get('domain', 'general')}\n"
        output_content += f"source: inherited\n"
        output_content += f"imported_from: \"{source}\"\n"
        if inst.get('source_repo'):
            output_content += f"source_repo: {inst.get('source_repo')}\n"
        output_content += "---\n\n"
        output_content += inst.get('content', '') + "\n\n"

    output_file.write_text(output_content)

    print(f"\n✅ Import complete!")
    print(f"   Added: {len(to_add)}")
    print(f"   Updated: {len(to_update)}")
    print(f"   Saved to: {output_file}")

    return 0


# ─────────────────────────────────────────────
# Export Command
# ─────────────────────────────────────────────

def cmd_export(args):
    """Export instincts to file."""
    instincts = load_all_instincts()

    if not instincts:
        print("No instincts to export.")
        return 1

    # Filter by domain if specified
    if args.domain:
        instincts = [i for i in instincts if i.get('domain') == args.domain]

    # Filter by minimum confidence
    if args.min_confidence:
        instincts = [i for i in instincts if i.get('confidence', 0.5) >= args.min_confidence]

    if not instincts:
        print("No instincts match the criteria.")
        return 1

    # Generate output
    output = f"# Instincts export\n# Date: {datetime.now().isoformat()}\n# Total: {len(instincts)}\n\n"

    for inst in instincts:
        output += "---\n"
        for key in ['id', 'trigger', 'confidence', 'domain', 'source', 'source_repo']:
            if inst.get(key):
                value = inst[key]
                if key == 'trigger':
                    output += f'{key}: "{value}"\n'
                else:
                    output += f"{key}: {value}\n"
        output += "---\n\n"
        output += inst.get('content', '') + "\n\n"

    # Write to file or stdout
    if args.output:
        Path(args.output).write_text(output)
        print(f"Exported {len(instincts)} instincts to {args.output}")
    else:
        print(output)

    return 0


# ─────────────────────────────────────────────
# Evolve Command
# ─────────────────────────────────────────────

def cmd_evolve(args):
    """Analyze instincts and suggest evolutions to skills/commands/agents."""
    instincts = load_all_instincts()

    if len(instincts) < 3:
        print("Need at least 3 instincts to analyze patterns.")
        print(f"Currently have: {len(instincts)}")
        return 1

    print(f"\n{'='*60}")
    print(f"  EVOLVE ANALYSIS - {len(instincts)} instincts")
    print(f"{'='*60}\n")

    # Group by domain
    by_domain = defaultdict(list)
    for inst in instincts:
        domain = inst.get('domain', 'general')
        by_domain[domain].append(inst)

    # High-confidence instincts by domain (candidates for skills)
    high_conf = [i for i in instincts if i.get('confidence', 0) >= 0.8]
    print(f"High confidence instincts (>=80%): {len(high_conf)}")

    # Find clusters (instincts with similar triggers)
    trigger_clusters = defaultdict(list)
    for inst in instincts:
        trigger = inst.get('trigger', '')
        # Normalize trigger
        trigger_key = trigger.lower()
        for keyword in ['when', 'creating', 'writing', 'adding', 'implementing', 'testing']:
            trigger_key = trigger_key.replace(keyword, '').strip()
        trigger_clusters[trigger_key].append(inst)

    # Find clusters with 3+ instincts (good skill candidates)
    skill_candidates = []
    for trigger, cluster in trigger_clusters.items():
        if len(cluster) >= 2:
            avg_conf = sum(i.get('confidence', 0.5) for i in cluster) / len(cluster)
            skill_candidates.append({
                'trigger': trigger,
                'instincts': cluster,
                'avg_confidence': avg_conf,
                'domains': list(set(i.get('domain', 'general') for i in cluster))
            })

    # Sort by cluster size and confidence
    skill_candidates.sort(key=lambda x: (-len(x['instincts']), -x['avg_confidence']))

    print(f"\nPotential skill clusters found: {len(skill_candidates)}")

    if skill_candidates:
        print(f"\n## SKILL CANDIDATES\n")
        for i, cand in enumerate(skill_candidates[:5], 1):
            print(f"{i}. Cluster: \"{cand['trigger']}\"")
            print(f"   Instincts: {len(cand['instincts'])}")
            print(f"   Avg confidence: {cand['avg_confidence']:.0%}")
            print(f"   Domains: {', '.join(cand['domains'])}")
            print(f"   Instincts:")
            for inst in cand['instincts'][:3]:
                print(f"     - {inst.get('id')}")
            print()

    # Command candidates (workflow instincts with high confidence)
    workflow_instincts = [i for i in instincts if i.get('domain') == 'workflow' and i.get('confidence', 0) >= 0.7]
    if workflow_instincts:
        print(f"\n## COMMAND CANDIDATES ({len(workflow_instincts)})\n")
        for inst in workflow_instincts[:5]:
            trigger = inst.get('trigger', 'unknown')
            # Suggest command name
            cmd_name = trigger.replace('when ', '').replace('implementing ', '').replace('a ', '')
            cmd_name = cmd_name.replace(' ', '-')[:20]
            print(f"  /{cmd_name}")
            print(f"    From: {inst.get('id')}")
            print(f"    Confidence: {inst.get('confidence', 0.5):.0%}")
            print()

    # Agent candidates (complex multi-step patterns)
    agent_candidates = [c for c in skill_candidates if len(c['instincts']) >= 3 and c['avg_confidence'] >= 0.75]
    if agent_candidates:
        print(f"\n## AGENT CANDIDATES ({len(agent_candidates)})\n")
        for cand in agent_candidates[:3]:
            agent_name = cand['trigger'].replace(' ', '-')[:20] + '-agent'
            print(f"  {agent_name}")
            print(f"    Covers {len(cand['instincts'])} instincts")
            print(f"    Avg confidence: {cand['avg_confidence']:.0%}")
            print()

    if args.generate:
        generated = _generate_evolved(skill_candidates, workflow_instincts, agent_candidates)
        if generated:
            print(f"\n✅ Generated {len(generated)} evolved structures:")
            for path in generated:
                print(f"   {path}")
        else:
            print("\nNo structures generated (need higher-confidence clusters).")

    print(f"\n{'='*60}\n")
    return 0


# ─────────────────────────────────────────────
# Generate Evolved Structures
# ─────────────────────────────────────────────

def _generate_evolved(skill_candidates: list, workflow_instincts: list, agent_candidates: list) -> list[str]:
    """Generate skill/command/agent files from analyzed instinct clusters."""
    generated = []

    # Generate skills from top candidates
    for cand in skill_candidates[:5]:
        trigger = cand['trigger'].strip()
        if not trigger:
            continue
        name = re.sub(r'[^a-z0-9]+', '-', trigger.lower()).strip('-')[:30]
        if not name:
            continue

        skill_dir = EVOLVED_DIR / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)

        content = f"# {name}\n\n"
        content += f"Evolved from {len(cand['instincts'])} instincts "
        content += f"(avg confidence: {cand['avg_confidence']:.0%})\n\n"
        content += f"## When to Apply\n\n"
        content += f"Trigger: {trigger}\n\n"
        content += f"## Actions\n\n"
        for inst in cand['instincts']:
            inst_content = inst.get('content', '')
            action_match = re.search(r'## Action\s*\n\s*(.+?)(?:\n\n|\n##|$)', inst_content, re.DOTALL)
            action = action_match.group(1).strip() if action_match else inst.get('id', 'unnamed')
            content += f"- {action}\n"

        (skill_dir / "SKILL.md").write_text(content)
        generated.append(str(skill_dir / "SKILL.md"))

    # Generate commands from workflow instincts
    for inst in workflow_instincts[:5]:
        trigger = inst.get('trigger', 'unknown')
        cmd_name = re.sub(r'[^a-z0-9]+', '-', trigger.lower().replace('when ', '').replace('implementing ', ''))
        cmd_name = cmd_name.strip('-')[:20]
        if not cmd_name:
            continue

        cmd_file = EVOLVED_DIR / "commands" / f"{cmd_name}.md"
        content = f"# {cmd_name}\n\n"
        content += f"Evolved from instinct: {inst.get('id', 'unnamed')}\n"
        content += f"Confidence: {inst.get('confidence', 0.5):.0%}\n\n"
        content += inst.get('content', '')

        cmd_file.write_text(content)
        generated.append(str(cmd_file))

    # Generate agents from complex clusters
    for cand in agent_candidates[:3]:
        trigger = cand['trigger'].strip()
        agent_name = re.sub(r'[^a-z0-9]+', '-', trigger.lower()).strip('-')[:20]
        if not agent_name:
            continue

        agent_file = EVOLVED_DIR / "agents" / f"{agent_name}.md"
        domains = ', '.join(cand['domains'])
        instinct_ids = [i.get('id', 'unnamed') for i in cand['instincts']]

        content = f"---\nmodel: sonnet\ntools: Read, Grep, Glob\n---\n"
        content += f"# {agent_name}\n\n"
        content += f"Evolved from {len(cand['instincts'])} instincts "
        content += f"(avg confidence: {cand['avg_confidence']:.0%})\n"
        content += f"Domains: {domains}\n\n"
        content += f"## Source Instincts\n\n"
        for iid in instinct_ids:
            content += f"- {iid}\n"

        agent_file.write_text(content)
        generated.append(str(agent_file))

    return generated


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Instinct CLI for Continuous Learning v2')
    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Status
    status_parser = subparsers.add_parser('status', help='Show instinct status')

    # Import
    import_parser = subparsers.add_parser('import', help='Import instincts')
    import_parser.add_argument('source', help='File path or URL')
    import_parser.add_argument('--dry-run', action='store_true', help='Preview without importing')
    import_parser.add_argument('--force', action='store_true', help='Skip confirmation')
    import_parser.add_argument('--min-confidence', type=float, help='Minimum confidence threshold')

    # Export
    export_parser = subparsers.add_parser('export', help='Export instincts')
    export_parser.add_argument('--output', '-o', help='Output file')
    export_parser.add_argument('--domain', help='Filter by domain')
    export_parser.add_argument('--min-confidence', type=float, help='Minimum confidence')

    # Evolve
    evolve_parser = subparsers.add_parser('evolve', help='Analyze and evolve instincts')
    evolve_parser.add_argument('--generate', action='store_true', help='Generate evolved structures')

    args = parser.parse_args()

    if args.command == 'status':
        return cmd_status(args)
    elif args.command == 'import':
        return cmd_import(args)
    elif args.command == 'export':
        return cmd_export(args)
    elif args.command == 'evolve':
        return cmd_evolve(args)
    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main() or 0)
