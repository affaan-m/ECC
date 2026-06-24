#!/usr/bin/env python3
"""
ECC Dashboard - Everything Claude Code GUI
Cross-platform TkInter application for managing ECC components
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import os
import json
from pathlib import Path
from typing import Dict, List, Optional
import logging
import webbrowser

from scripts.lib.ecc_dashboard_runtime import launch_terminal, maximize_window

logger = logging.getLogger(__name__)

# ============================================================================
# DATA LOADERS - Load ECC data from the project
# ============================================================================

def get_project_path() -> str:
    """Get the ECC project path - assumes this script is run from the project dir"""
    return os.path.dirname(os.path.abspath(__file__))


def load_agents(project_path: str) -> List[Dict]:
    """Load agents by scanning the agents/ directory.

    Parses YAML frontmatter (name, description) from each agent file.
    The directory is the source of truth; AGENTS.md is hand-maintained
    and drifts out of sync.
    """
    agents_dir = os.path.join(project_path, "agents")
    agents: List[Dict] = []

    if os.path.isdir(agents_dir):
        for item in sorted(os.listdir(agents_dir)):
            if not item.endswith('.md'):
                continue
            agent_path = os.path.join(agents_dir, item)
            name = os.path.splitext(item)[0]
            description = ''
            try:
                with open(agent_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except OSError:
                content = ''
            if content.startswith('---'):
                end = content.find('\n---', 3)
                if end != -1:
                    for fm_line in content[3:end].splitlines():
                        stripped = fm_line.strip()
                        if stripped.startswith('name:'):
                            name = stripped.split(':', 1)[1].strip().strip('"\'')
                        elif stripped.startswith('description:'):
                            description = stripped.split(':', 1)[1].strip().strip('"\'')
            agents.append({
                'name': name,
                'purpose': description,
                'when_to_use': description,
                'path': agent_path,
            })

    # Fallback default agents if directory not found
    if not agents:
        agents = [
            {'name': 'planner', 'purpose': 'Implementation planning', 'when_to_use': 'Complex features, refactoring'},
            {'name': 'architect', 'purpose': 'System design and scalability', 'when_to_use': 'Architectural decisions'},
            {'name': 'tdd-guide', 'purpose': 'Test-driven development', 'when_to_use': 'New features, bug fixes'},
            {'name': 'code-reviewer', 'purpose': 'Code quality and maintainability', 'when_to_use': 'After writing/modifying code'},
            {'name': 'security-reviewer', 'purpose': 'Vulnerability detection', 'when_to_use': 'Before commits, sensitive code'},
            {'name': 'build-error-resolver', 'purpose': 'Fix build/type errors', 'when_to_use': 'When build fails'},
            {'name': 'e2e-runner', 'purpose': 'End-to-end Playwright testing', 'when_to_use': 'Critical user flows'},
            {'name': 'refactor-cleaner', 'purpose': 'Dead code cleanup', 'when_to_use': 'Code maintenance'},
            {'name': 'doc-updater', 'purpose': 'Documentation and codemaps', 'when_to_use': 'Updating docs'},
            {'name': 'go-reviewer', 'purpose': 'Go code review', 'when_to_use': 'Go projects'},
            {'name': 'python-reviewer', 'purpose': 'Python code review', 'when_to_use': 'Python projects'},
            {'name': 'typescript-reviewer', 'purpose': 'TypeScript/JavaScript code review', 'when_to_use': 'TypeScript projects'},
            {'name': 'rust-reviewer', 'purpose': 'Rust code review', 'when_to_use': 'Rust projects'},
            {'name': 'java-reviewer', 'purpose': 'Java and Spring Boot code review', 'when_to_use': 'Java projects'},
            {'name': 'kotlin-reviewer', 'purpose': 'Kotlin code review', 'when_to_use': 'Kotlin projects'},
            {'name': 'cpp-reviewer', 'purpose': 'C/C++ code review', 'when_to_use': 'C/C++ projects'},
            {'name': 'database-reviewer', 'purpose': 'PostgreSQL/Supabase specialist', 'when_to_use': 'Database work'},
            {'name': 'loop-operator', 'purpose': 'Autonomous loop execution', 'when_to_use': 'Run loops safely'},
            {'name': 'harness-optimizer', 'purpose': 'Harness config tuning', 'when_to_use': 'Reliability, cost, throughput'},
        ]
    
    return agents

def load_skills(project_path: str) -> List[Dict]:
    """Load skills from skills directory"""
    skills_dir = os.path.join(project_path, "skills")
    skills = []
    
    if os.path.exists(skills_dir):
        for item in os.listdir(skills_dir):
            skill_path = os.path.join(skills_dir, item)
            if os.path.isdir(skill_path):
                skill_file = os.path.join(skill_path, "SKILL.md")
                description = item.replace('-', ' ').title()
                
                if os.path.exists(skill_file):
                    try:
                        with open(skill_file, 'r', encoding='utf-8') as f:
                            content = f.read()
                            # Extract description from first lines
                            lines = content.split('\n')
                            for line in lines:
                                if line.strip() and not line.startswith('#'):
                                    description = line.strip()[:100]
                                    break
                                if line.startswith('# '):
                                    description = line[2:].strip()[:100]
                                    break
                    except Exception:
                        logger.debug("Failed to parse skill file %s", skill_file, exc_info=True)

                # Determine category
                category = "General"
                item_lower = item.lower()
                if 'python' in item_lower or 'django' in item_lower:
                    category = "Python"
                elif 'golang' in item_lower or 'go-' in item_lower:
                    category = "Go"
                elif 'frontend' in item_lower or 'react' in item_lower:
                    category = "Frontend"
                elif 'backend' in item_lower or 'api' in item_lower:
                    category = "Backend"
                elif 'security' in item_lower:
                    category = "Security"
                elif 'testing' in item_lower or 'tdd' in item_lower:
                    category = "Testing"
                elif 'docker' in item_lower or 'deployment' in item_lower:
                    category = "DevOps"
                elif 'swift' in item_lower or 'ios' in item_lower:
                    category = "iOS"
                elif 'java' in item_lower or 'spring' in item_lower:
                    category = "Java"
                elif 'rust' in item_lower:
                    category = "Rust"
                
                skills.append({
                    'name': item,
                    'description': description,
                    'category': category,
                    'path': skill_path
                })
    
    # Fallback if directory doesn't exist
    if not skills:
        skills = [
            {'name': 'tdd-workflow', 'description': 'Test-driven development workflow', 'category': 'Testing'},
            {'name': 'coding-standards', 'description': 'Baseline coding conventions', 'category': 'General'},
            {'name': 'security-review', 'description': 'Security checklist and patterns', 'category': 'Security'},
            {'name': 'frontend-patterns', 'description': 'React and Next.js patterns', 'category': 'Frontend'},
            {'name': 'backend-patterns', 'description': 'API and database patterns', 'category': 'Backend'},
            {'name': 'api-design', 'description': 'REST API design patterns', 'category': 'Backend'},
            {'name': 'docker-patterns', 'description': 'Docker and container patterns', 'category': 'DevOps'},
            {'name': 'e2e-testing', 'description': 'Playwright E2E testing patterns', 'category': 'Testing'},
            {'name': 'verification-loop', 'description': 'Build, test, lint verification', 'category': 'General'},
            {'name': 'python-patterns', 'description': 'Python idioms and best practices', 'category': 'Python'},
            {'name': 'golang-patterns', 'description': 'Go idioms and best practices', 'category': 'Go'},
            {'name': 'django-patterns', 'description': 'Django patterns and best practices', 'category': 'Python'},
            {'name': 'springboot-patterns', 'description': 'Java Spring Boot patterns', 'category': 'Java'},
            {'name': 'laravel-patterns', 'description': 'Laravel architecture patterns', 'category': 'PHP'},
        ]
    
    return skills

def load_commands(project_path: str) -> List[Dict]:
    """Load commands from commands directory"""
    commands_dir = os.path.join(project_path, "commands")
    commands = []
    
    if os.path.exists(commands_dir):
        for item in os.listdir(commands_dir):
            if item.endswith('.md'):
                cmd_name = item[:-3]
                description = ""
                
                try:
                    with open(os.path.join(commands_dir, item), 'r', encoding='utf-8') as f:
                        content = f.read()
                        lines = content.split('\n')
                        for line in lines:
                            if line.startswith('# '):
                                description = line[2:].strip()
                                break
                except Exception:
                    logger.debug("Failed to parse command file %s", item, exc_info=True)

                commands.append({
                    'name': cmd_name,
                    'description': description or cmd_name.replace('-', ' ').title()
                })
    
    # Fallback commands
    if not commands:
        commands = [
            {'name': 'plan', 'description': 'Create implementation plan'},
            {'name': 'tdd', 'description': 'Test-driven development workflow'},
            {'name': 'code-review', 'description': 'Review code for quality and security'},
            {'name': 'build-fix', 'description': 'Fix build and TypeScript errors'},
            {'name': 'e2e', 'description': 'Generate and run E2E tests'},
            {'name': 'refactor-clean', 'description': 'Remove dead code'},
            {'name': 'verify', 'description': 'Run verification loop'},
            {'name': 'eval', 'description': 'Run evaluation against criteria'},
            {'name': 'security', 'description': 'Run comprehensive security review'},
            {'name': 'test-coverage', 'description': 'Analyze test coverage'},
            {'name': 'update-docs', 'description': 'Update documentation'},
            {'name': 'setup-pm', 'description': 'Configure package manager'},
            {'name': 'go-review', 'description': 'Go code review'},
            {'name': 'go-test', 'description': 'Go TDD workflow'},
            {'name': 'python-review', 'description': 'Python code review'},
        ]
    
    return commands

def load_rules(project_path: str) -> List[Dict]:
    """Load rules from rules directory"""
    rules_dir = os.path.join(project_path, "rules")
    rules = []
    
    if os.path.exists(rules_dir):
        for item in os.listdir(rules_dir):
            item_path = os.path.join(rules_dir, item)
            if os.path.isdir(item_path):
                # Common rules
                if item == "common":
                    for file in os.listdir(item_path):
                        if file.endswith('.md'):
                            rules.append({
                                'name': file[:-3],
                                'language': 'Common',
                                'path': os.path.join(item_path, file)
                            })
                else:
                    # Language-specific rules
                    for file in os.listdir(item_path):
                        if file.endswith('.md'):
                            rules.append({
                                'name': file[:-3],
                                'language': item.title(),
                                'path': os.path.join(item_path, file)
                            })
    
    # Fallback rules
    if not rules:
        rules = [
            {'name': 'coding-style', 'language': 'Common', 'path': ''},
            {'name': 'git-workflow', 'language': 'Common', 'path': ''},
            {'name': 'testing', 'language': 'Common', 'path': ''},
            {'name': 'performance', 'language': 'Common', 'path': ''},
            {'name': 'patterns', 'language': 'Common', 'path': ''},
            {'name': 'security', 'language': 'Common', 'path': ''},
            {'name': 'typescript', 'language': 'TypeScript', 'path': ''},
            {'name': 'python', 'language': 'Python', 'path': ''},
            {'name': 'golang', 'language': 'Go', 'path': ''},
            {'name': 'swift', 'language': 'Swift', 'path': ''},
            {'name': 'php', 'language': 'PHP', 'path': ''},
        ]
    
    return rules

# ============================================================================
# MAIN APPLICATION
# ============================================================================

class ECCDashboard(tk.Tk):
    """Main ECC Dashboard Application"""
    
    def __init__(self):
        super().__init__()
        
        self.project_path = get_project_path()
        self.title("ECC Dashboard - Everything Claude Code")
        
        maximize_window(self)
        
        try:
            self.icon_image = tk.PhotoImage(file='assets/images/ecc-logo.png')
            self.iconphoto(True, self.icon_image)
        except Exception:
            logger.debug("Failed to load window icon", exc_info=True)
        
        self.minsize(800, 600)
        
        # Load data
        self.agents = load_agents(self.project_path)
        self.skills = load_skills(self.project_path)
        self.commands = load_commands(self.project_path)
        self.rules = load_rules(self.project_path)
        
        # Settings
        self.settings = {
            'project_path': self.project_path,
            'theme': 'light'
        }
        
        # Setup UI
        self.setup_styles()
        self.create_widgets()
        
        # Center window
        self.center_window()
    
    def setup_styles(self):
        """Setup ttk styles for modern look"""
        style = ttk.Style()
        style.theme_use('clam')
        
        # Configure tab style
        style.configure('TNotebook', background='#f0f0f0')
        style.configure('TNotebook.Tab', padding=[10, 5], font=('Arial', 10))
        style.map('TNotebook.Tab', background=[('selected', '#ffffff')])
        
        # Configure Treeview
        style.configure('Treeview', font=('Arial', 10), rowheight=25)
        style.configure('Treeview.Heading', font=('Arial', 10, 'bold'))
        
        # Configure buttons
        style.configure('TButton', font=('Arial', 10), padding=5)
    
    def center_window(self):
        """Center the window on screen"""
        self.update_idletasks()
        width = self.winfo_width()
        height = self.winfo_height()
        x = (self.winfo_screenwidth() // 2) - (width // 2)
        y = (self.winfo_screenheight() // 2) - (height // 2)
        self.geometry(f'{width}x{height}+{x}+{y}')
    
    def create_widgets(self):
        """Create all UI widgets"""
        # Main container
        main_frame = ttk.Frame(self)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Header
        header_frame = ttk.Frame(main_frame)
        header_frame.pack(fill=tk.X, pady=(0, 10))
        
        try:
            self.logo_image = tk.PhotoImage(file='assets/images/ecc-logo.png')
            self.logo_image = self.logo_image.subsample(2, 2)
            ttk.Label(header_frame, image=self.logo_image).pack(side=tk.LEFT, padx=(0, 10))
        except Exception:
            logger.debug("Failed to load header logo", exc_info=True)
        
        self.title_label = ttk.Label(header_frame, text="ECC Dashboard", font=('Open Sans', 18, 'bold'))
        self.title_label.pack(side=tk.LEFT)
        self.version_label = ttk.Label(header_frame, text="v1.10.0", font=('Open Sans', 10), foreground='gray')
        self.version_label.pack(side=tk.LEFT, padx=(10, 0))
        
        # Notebook (tabs)
        self.notebook = ttk.Notebook(main_frame)
        self.notebook.pack(fill=tk.BOTH, expand=True)
        
        # Create tabs
        self.create_agents_tab()
        self.create_skills_tab()
        self.create_commands_tab()
        self.create_rules_tab()
        self.create_settings_tab()
        
        # Status bar
        status_frame = ttk.Frame(main_frame)
        status_frame.pack(fill=tk.X, pady=(10, 0))
        
        self.status_label = ttk.Label(status_frame, 
                                       text=f"Ready | Agents: {len(self.agents)} | Skills: {len(self.skills)} | Commands: {len(self.commands)}",
                                       font=('Arial', 9), foreground='gray')
        self.status_label.pack(side=tk.LEFT)
    
    # =========================================================================
    # AGENTS TAB
    # =========================================================================
    
    def create_agents_tab(self):
        """Create Agents tab"""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=f"Agents ({len(self.agents)})")
        
        # Search bar
        search_frame = ttk.Frame(frame)
        search_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(search_frame, text="Search:").pack(side=tk.LEFT)
        self.agent_search = ttk.Entry(search_frame, width=30)
        self.agent_search.pack(side=tk.LEFT, padx=5)
        self.agent_search.bind('<KeyRelease>', self.filter_agents)
        
        ttk.Label(search_frame, text="Count:").pack(side=tk.LEFT, padx=(20, 0))
        self.agent_count_label = ttk.Label(search_frame, text=str(len(self.agents)))
        self.agent_count_label.pack(side=tk.LEFT)
        
        # Split pane: list + details
        paned = ttk.PanedWindow(frame, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        
        # Agent list
        list_frame = ttk.Frame(paned)
        paned.add(list_frame, weight=2)
        
        columns = ('name', 'purpose')
        self.agent_tree = ttk.Treeview(list_frame, columns=columns, show='tree headings')
        self.agent_tree.heading('#0', text='#')
        self.agent_tree.heading('name', text='Agent Name')
        self.agent_tree.heading('purpose', text='Purpose')
        self.agent_tree.column('#0', width=40)
        self.agent_tree.column('name', width=180)
        self.agent_tree.column('purpose', width=250)
        
        self.agent_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # Scrollbar
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.agent_tree.yview)
        self.agent_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Details panel
        details_frame = ttk.Frame(paned)
        paned.add(details_frame, weight=1)
        
        ttk.Label(details_frame, text="Details", font=('Arial', 11, 'bold')).pack(anchor=tk.W, pady=5)
        
        self.agent_details = scrolledtext.ScrolledText(details_frame, wrap=tk.WORD, height=15)
        self.agent_details.pack(fill=tk.BOTH, expand=True)
        
        # Bind selection
        self.agent_tree.bind('<<TreeviewSelect>>', self.on_agent_select)
        
        # Populate list
        self.populate_agents(self.agents)
    
    def populate_agents(self, agents: List[Dict]):
        """Populate agents list"""
        for item in self.agent_tree.get_children():
            self.agent_tree.delete(item)
        
        for i, agent in enumerate(agents, 1):
            self.agent_tree.insert('', tk.END, text=str(i), values=(agent['name'], agent['purpose']))
    
    def filter_agents(self, event=None):
        """Filter agents based on search"""
        query = self.agent_search.get().lower()
        
        if not query:
            filtered = self.agents
        else:
            filtered = [a for a in self.agents 
                       if query in a['name'].lower() or query in a['purpose'].lower()]
        
        self.populate_agents(filtered)
        self.agent_count_label.config(text=str(len(filtered)))
    
    def on_agent_select(self, event):
        """Handle agent selection"""
        selection = self.agent_tree.selection()
        if not selection:
            return
        
        item = self.agent_tree.item(selection[0])
        agent_name = item['values'][0]
        
        agent = next((a for a in self.agents if a['name'] == agent_name), None)
        if agent:
            details = f"""Agent: {agent['name']}

Purpose: {agent['purpose']}

When to Use: {agent['when_to_use']}

---
Usage in Claude Code:
Use the /{agent['name']} command or invoke via agent delegation."""
            self.agent_details.delete('1.0', tk.END)
            self.agent_details.insert('1.0', details)
    
    # =========================================================================
    # SKILLS TAB
    # =========================================================================
    
    def create_skills_tab(self):
        """Create Skills tab"""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=f"Skills ({len(self.skills)})")
        
        # Search and filter
        filter_frame = ttk.Frame(frame)
        filter_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(filter_frame, text="Search:").pack(side=tk.LEFT)
        self.skill_search = ttk.Entry(filter_frame, width=25)
        self.skill_search.pack(side=tk.LEFT, padx=5)
        self.skill_search.bind('<KeyRelease>', self.filter_skills)
        
        ttk.Label(filter_frame, text="Category:").pack(side=tk.LEFT, padx=(20, 0))
        self.skill_category = ttk.Combobox(filter_frame, values=['All'] + self.get_categories(), width=15)
        self.skill_category.set('All')
        self.skill_category.pack(side=tk.LEFT, padx=5)
        self.skill_category.bind('<<ComboboxSelected>>', self.filter_skills)
        
        ttk.Label(filter_frame, text="Count:").pack(side=tk.LEFT, padx=(20, 0))
        self.skill_count_label = ttk.Label(filter_frame, text=str(len(self.skills)))
        self.skill_count_label.pack(side=tk.LEFT)
        
        # Split pane
        paned = ttk.PanedWindow(frame, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        
        # Skill list
        list_frame = ttk.Frame(paned)
        paned.add(list_frame, weight=1)
        
        columns = ('name', 'category', 'description')
        self.skill_tree = ttk.Treeview(list_frame, columns=columns, show='tree headings')
        self.skill_tree.heading('#0', text='#')
        self.skill_tree.heading('name', text='Skill Name')
        self.skill_tree.heading('category', text='Category')
        self.skill_tree.heading('description', text='Description')
        
        self.skill_tree.column('#0', width=40)
        self.skill_tree.column('name', width=180)
        self.skill_tree.column('category', width=100)
        self.skill_tree.column('description', width=300)
        
        self.skill_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.skill_tree.yview)
        self.skill_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Details
        details_frame = ttk.Frame(paned)
        paned.add(details_frame, weight=1)
        
        ttk.Label(details_frame, text="Description", font=('Arial', 11, 'bold')).pack(anchor=tk.W, pady=5)
        
        self.skill_details = scrolledtext.ScrolledText(details_frame, wrap=tk.WORD, height=15)
        self.skill_details.pack(fill=tk.BOTH, expand=True)
        
        self.skill_tree.bind('<<TreeviewSelect>>', self.on_skill_select)
        
        self.populate_skills(self.skills)
    
    def get_categories(self) -> List[str]:
        """Get unique categories from skills"""
        categories = set(s['category'] for s in self.skills)
        return sorted(categories)
    
    def populate_skills(self, skills: List[Dict]):
        """Populate skills list"""
        for item in self.skill_tree.get_children():
            self.skill_tree.delete(item)
        
        for i, skill in enumerate(skills, 1):
            self.skill_tree.insert('', tk.END, text=str(i), 
                                  values=(skill['name'], skill['category'], skill['description']))
    
    def filter_skills(self, event=None):
        """Filter skills based on search and category"""
        search = self.skill_search.get().lower()
        category = self.skill_category.get()
        
        filtered = self.skills
        
        if category != 'All':
            filtered = [s for s in filtered if s['category'] == category]
        
        if search:
            filtered = [s for s in filtered 
                       if search in s['name'].lower() or search in s['description'].lower()]
        
        self.populate_skills(filtered)
        self.skill_count_label.config(text=str(len(filtered)))
    
    def on_skill_select(self, event):
        """Handle skill selection"""
        selection = self.skill_tree.selection()
        if not selection:
            return
        
        item = self.skill_tree.item(selection[0])
        skill_name = item['values'][0]
        
        skill = next((s for s in self.skills if s['name'] == skill_name), None)
        if skill:
            details = f"""Skill: {skill['name']}

Category: {skill['category']}

Description: {skill['description']}

Path: {skill['path']}

---
Usage: This skill is automatically activated when working with related technologies."""
            self.skill_details.delete('1.0', tk.END)
            self.skill_details.insert('1.0', details)
    
    # =========================================================================
    # COMMANDS TAB
    # =========================================================================
    
    def create_commands_tab(self):
        """Create Commands tab"""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=f"Commands ({len(self.commands)})")
        
        # Info
        info_frame = ttk.Frame(frame)
        info_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(info_frame, text="Slash Commands for Claude Code:", 
                  font=('Arial', 10, 'bold')).pack(anchor=tk.W)
        ttk.Label(info_frame, text="Use these commands in Claude Code by typing /command_name", 
                  foreground='gray').pack(anchor=tk.W)
        
        # Commands list
        list_frame = ttk.Frame(frame)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        
        columns = ('name', 'description')
        self.command_tree = ttk.Treeview(list_frame, columns=columns, show='tree headings')
        self.command_tree.heading('#0', text='#')
        self.command_tree.heading('name', text='Command')
        self.command_tree.heading('description', text='Description')
        
        self.command_tree.column('#0', width=40)
        self.command_tree.column('name', width=150)
        self.command_tree.column('description', width=400)
        
        self.command_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.command_tree.yview)
        self.command_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Populate
        for i, cmd in enumerate(self.commands, 1):
            self.command_tree.insert('', tk.END, text=str(i), 
                                   values=('/' + cmd['name'], cmd['description']))
    
    # =========================================================================
    # RULES TAB
    # =========================================================================
    
    def create_rules_tab(self):
        """Create Rules tab"""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text=f"Rules ({len(self.rules)})")
        
        # Info
        info_frame = ttk.Frame(frame)
        info_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(info_frame, text="Coding Rules by Language:", 
                  font=('Arial', 10, 'bold')).pack(anchor=tk.W)
        ttk.Label(info_frame, text="These rules are automatically applied in Claude Code", 
                  foreground='gray').pack(anchor=tk.W)
        
        # Filter
        filter_frame = ttk.Frame(frame)
        filter_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(filter_frame, text="Language:").pack(side=tk.LEFT)
        self.rules_language = ttk.Combobox(filter_frame, 
                                           values=['All'] + self.get_rule_languages(), 
                                           width=15)
        self.rules_language.set('All')
        self.rules_language.pack(side=tk.LEFT, padx=5)
        self.rules_language.bind('<<ComboboxSelected>>', self.filter_rules)
        
        # Rules list
        list_frame = ttk.Frame(frame)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        
        columns = ('name', 'language')
        self.rules_tree = ttk.Treeview(list_frame, columns=columns, show='tree headings')
        self.rules_tree.heading('#0', text='#')
        self.rules_tree.heading('name', text='Rule Name')
        self.rules_tree.heading('language', text='Language')
        
        self.rules_tree.column('#0', width=40)
        self.rules_tree.column('name', width=250)
        self.rules_tree.column('language', width=100)
        
        self.rules_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.rules_tree.yview)
        self.rules_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.populate_rules(self.rules)
    
    def get_rule_languages(self) -> List[str]:
        """Get unique languages from rules"""
        languages = set(r['language'] for r in self.rules)
        return sorted(languages)
    
    def populate_rules(self, rules: List[Dict]):
        """Populate rules list"""
        for item in self.rules_tree.get_children():
            self.rules_tree.delete(item)
        
        for i, rule in enumerate(rules, 1):
            self.rules_tree.insert('', tk.END, text=str(i),
                                  values=(rule['name'], rule['language']))
    
    def filter_rules(self, event=None):
        """Filter rules by language"""
        language = self.rules_language.get()
        
        if language == 'All':
            filtered = self.rules
        else:
            filtered = [r for r in self.rules if r['language'] == language]
        
        self.populate_rules(filtered)
    
    # =========================================================================
    # SETTINGS TAB
    # =========================================================================
    
    def create_settings_tab(self):
        """Create Settings tab"""
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="Settings")
        
        # Project path
        path_frame = ttk.LabelFrame(frame, text="Project Path", padding=10)
        path_frame.pack(fill=tk.X, padx=10, pady=10)
        
        self.path_entry = ttk.Entry(path_frame, width=60)
        self.path_entry.insert(0, self.project_path)
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        ttk.Button(path_frame, text="Browse...", command=self.browse_path).pack(side=tk.LEFT, padx=5)
        
        # Theme
        theme_frame = ttk.LabelFrame(frame, text="Appearance", padding=10)
        theme_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(theme_frame, text="Theme:").pack(anchor=tk.W)
        self.theme_var = tk.StringVar(value='light')
        light_rb = ttk.Radiobutton(theme_frame, text="Light", variable=self.theme_var, 
                       value='light', command=self.apply_theme)
        light_rb.pack(anchor=tk.W)
        dark_rb = ttk.Radiobutton(theme_frame, text="Dark", variable=self.theme_var, 
                       value='dark', command=self.apply_theme)
        dark_rb.pack(anchor=tk.W)
        
        font_frame = ttk.LabelFrame(frame, text="Font", padding=10)
        font_frame.pack(fill=tk.X, padx=10, pady=10)
        
        ttk.Label(font_frame, text="Font Family:").pack(anchor=tk.W)
        self.font_var = tk.StringVar(value='Open Sans')
        
        fonts = ['Open Sans', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS']
        self.font_combo = ttk.Combobox(font_frame, textvariable=self.font_var, values=fonts, state='readonly')
        self.font_combo.pack(anchor=tk.W, fill=tk.X, pady=(5, 0))
        self.font_combo.bind('<<ComboboxSelected>>', lambda e: self.apply_theme())
        
        ttk.Label(font_frame, text="Font Size:").pack(anchor=tk.W, pady=(10, 0))
        self.size_var = tk.StringVar(value='10')
        sizes = ['8', '9', '10', '11', '12', '14', '16', '18', '20']
        self.size_combo = ttk.Combobox(font_frame, textvariable=self.size_var, values=sizes, state='readonly', width=10)
        self.size_combo.pack(anchor=tk.W, pady=(5, 0))
        self.size_combo.bind('<<ComboboxSelected>>', lambda e: self.apply_theme())
        
        # Quick Actions
        actions_frame = ttk.LabelFrame(frame, text="Quick Actions", padding=10)
        actions_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        ttk.Button(actions_frame, text="Open Project in Terminal", 
                  command=self.open_terminal).pack(fill=tk.X, pady=2)
        ttk.Button(actions_frame, text="Open README", 
                  command=self.open_readme).pack(fill=tk.X, pady=2)
        ttk.Button(actions_frame, text="Open AGENTS.md", 
                  command=self.open_agents).pack(fill=tk.X, pady=2)
        ttk.Button(actions_frame, text="Refresh Data", 
                  command=self.refresh_data).pack(fill=tk.X, pady=2)
        
        # About
        about_frame = ttk.LabelFrame(frame, text="About", padding=10)
        about_frame.pack(fill=tk.X, padx=10, pady=10)
        
        about_text = """ECC Dashboard v1.0.0
Everything Claude Code GUI

A cross-platform desktop application for 
managing and exploring ECC components.

Version: 1.10.0
Project: github.com/affaan-m/everything-claude-code"""
        
        ttk.Label(about_frame, text=about_text, justify=tk.LEFT).pack(anchor=tk.W)
    
    def browse_path(self):
        """Browse for project path"""
        from tkinter import filedialog
        path = filedialog.askdirectory(initialdir=self.project_path)
        if path:
            self.path_entry.delete(0, tk.END)
            self.path_entry.insert(0, path)
    
    def open_terminal(self):
        """Open terminal at project path"""
        path = os.path.realpath(self.path_entry.get())
        try:
            launch_terminal(path)
        except Exception as exc:
            messagebox.showerror("Error", f"Could not open terminal: {exc}")

    def _open_project_doc(self, filename: str) -> None:
        """Open a project document safely, constrained to the project directory."""
        base = os.path.realpath(self.path_entry.get())
        target = os.path.realpath(os.path.join(base, filename))
        if os.path.commonpath([base, target]) != base:
            messagebox.showerror("Error", "Access denied: path is outside the project directory")
            return
        if os.path.exists(target):
            webbrowser.open(Path(target).as_uri())
        else:
            messagebox.showerror("Error", f"{filename} not found")

    def open_readme(self):
        """Open README in default browser/reader"""
        self._open_project_doc('README.md')
    
    def open_agents(self):
        """Open AGENTS.md"""
        self._open_project_doc('AGENTS.md')
    
    def refresh_data(self):
        """Refresh all data"""
        self.project_path = self.path_entry.get()
        self.agents = load_agents(self.project_path)
        self.skills = load_skills(self.project_path)
        self.commands = load_commands(self.project_path)
        self.rules = load_rules(self.project_path)
        
        # Update tabs
        self.notebook.tab(0, text=f"Agents ({len(self.agents)})")
        self.notebook.tab(1, text=f"Skills ({len(self.skills)})")
        self.notebook.tab(2, text=f"Commands ({len(self.commands)})")
        self.notebook.tab(3, text=f"Rules ({len(self.rules)})")
        
        # Repopulate
        self.populate_agents(self.agents)
        self.populate_skills(self.skills)
        
        # Update status
        self.status_label.config(
            text=f"Ready | Agents: {len(self.agents)} | Skills: {len(self.skills)} | Commands: {len(self.commands)}"
        )
        
        messagebox.showinfo("Success", "Data refreshed successfully!")

    def apply_theme(self):
        theme = self.theme_var.get()
        font_family = self.font_var.get()
        font_size = int(self.size_var.get())
        font_tuple = (font_family, font_size)
        
        if theme == 'dark':
            bg_color = '#2b2b2b'
            fg_color = '#ffffff'
            entry_bg = '#3c3c3c'
            frame_bg = '#2b2b2b'
            select_bg = '#0f5a9e'
        else:
            bg_color = '#f0f0f0'
            fg_color = '#000000'
            entry_bg = '#ffffff'
            frame_bg = '#f0f0f0'
            select_bg = '#e0e0e0'
        
        self.configure(background=bg_color)
        
        style = ttk.Style()
        style.configure('.', background=bg_color, foreground=fg_color, font=font_tuple)
        style.configure('TFrame', background=bg_color, font=font_tuple)
        style.configure('TLabel', background=bg_color, foreground=fg_color, font=font_tuple)
        style.configure('TNotebook', background=bg_color, font=font_tuple)
        style.configure('TNotebook.Tab', background=frame_bg, foreground=fg_color, font=font_tuple)
        style.map('TNotebook.Tab', background=[('selected', select_bg)])
        style.configure('Treeview', background=entry_bg, foreground=fg_color, fieldbackground=entry_bg, font=font_tuple)
        style.configure('Treeview.Heading', background=frame_bg, foreground=fg_color, font=font_tuple)
        style.configure('TEntry', fieldbackground=entry_bg, foreground=fg_color, font=font_tuple)
        style.configure('TButton', background=frame_bg, foreground=fg_color, font=font_tuple)
        
        self.title_label.configure(font=(font_family, 18, 'bold'))
        self.version_label.configure(font=(font_family, 10))
        
        def update_widget_colors(widget):
            try:
                widget.configure(background=bg_color)
            except Exception:
                logger.debug("Cannot set background on %s", widget.__class__.__name__, exc_info=True)
            try:
                children = widget.winfo_children()
            except Exception:
                logger.debug("Cannot list child widgets on %s", widget.__class__.__name__, exc_info=True)
                return
            for child in children:
                try:
                    update_widget_colors(child)
                except Exception:
                    logger.debug("Cannot update child widget colors on %s", child.__class__.__name__, exc_info=True)

        update_widget_colors(self)
        
        self.update()


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point"""
    app = ECCDashboard()
    app.mainloop()


if __name__ == "__main__":
    main()
