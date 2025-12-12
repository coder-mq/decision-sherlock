import React, { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid'; // Actually we don't have uuid lib, let's use simple random string
import { 
  DecisionState, 
  DecisionCriteria, 
  DecisionOption, 
  Attachment 
} from './types';
import { analyzeDecision } from './services/geminiService';
import { AnalysisView } from './components/AnalysisView';
import { 
  Button, 
  Input, 
  Textarea, 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  Slider,
  Label
} from './components/ui';
import { 
  Plus, 
  Trash2, 
  Upload, 
  Scale, 
  Search, 
  ChevronRight, 
  ChevronLeft,
  Briefcase,
  Home,
  FileText,
  Loader2,
  X
} from 'lucide-react';

const genId = () => Math.random().toString(36).substring(2, 9);

const INITIAL_STATE: DecisionState = {
  title: '',
  description: '',
  criteria: [
    { id: 'c1', name: 'Cost / Salary', weight: 8 },
    { id: 'c2', name: 'Long-term Benefit', weight: 7 },
    { id: 'c3', name: 'Enjoyment', weight: 9 }
  ],
  options: [
    { id: 'o1', name: 'Option A', description: '', attachments: [] },
    { id: 'o2', name: 'Option B', description: '', attachments: [] }
  ],
  result: null
};

// Quick Templates
const TEMPLATES = [
    { label: "Job Offer", icon: Briefcase, title: "Job Offer A vs Job Offer B", criteria: ["Salary", "Culture", "Growth", "Commute"] },
    { label: "Apartment", icon: Home, title: "Apartment Hunting", criteria: ["Rent", "Location", "Size", "Amenities"] },
    { label: "Contract", icon: FileText, title: "Vendor Selection", criteria: ["Price", "Reliability", "Terms", "Support"] }
];

export default function App() {
  const [step, setStep] = useState<number>(0); // 0=Intro, 1=Setup, 2=Criteria, 3=Options, 4=Loading, 5=Results
  const [state, setState] = useState<DecisionState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);

  const updateState = (updates: Partial<DecisionState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setState({
        ...INITIAL_STATE,
        title: t.title,
        criteria: t.criteria.map(name => ({ id: genId(), name, weight: 5 }))
    });
    setStep(1);
  };

  // Handlers for Criteria
  const addCriteria = () => {
    updateState({
      criteria: [...state.criteria, { id: genId(), name: '', weight: 5 }]
    });
  };
  const updateCriteria = (id: string, updates: Partial<DecisionCriteria>) => {
    updateState({
      criteria: state.criteria.map(c => c.id === id ? { ...c, ...updates } : c)
    });
  };
  const removeCriteria = (id: string) => {
    updateState({ criteria: state.criteria.filter(c => c.id !== id) });
  };

  // Handlers for Options
  const addOption = () => {
    updateState({
      options: [...state.options, { id: genId(), name: `Option ${String.fromCharCode(65 + state.options.length)}`, description: '', attachments: [] }]
    });
  };
  const updateOption = (id: string, updates: Partial<DecisionOption>) => {
    updateState({
      options: state.options.map(o => o.id === id ? { ...o, ...updates } : o)
    });
  };
  const removeOption = (id: string) => {
    updateState({ options: state.options.filter(o => o.id !== id) });
  };

  // File Upload Helper
  const handleFileUpload = async (optionId: string, files: FileList | null) => {
    if (!files) return;
    
    const newAttachments: Attachment[] = [];
    const MAX_SIZE = 4 * 1024 * 1024; // 4MB limit per file for client safety

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > MAX_SIZE) {
            alert(`File ${file.name} is too large (Max 4MB).`);
            continue;
        }

        const reader = new FileReader();
        const promise = new Promise<void>((resolve) => {
            reader.onload = (e) => {
                const result = e.target?.result as string;
                // remove data:image/png;base64, prefix for API
                const base64Data = result.split(',')[1];
                newAttachments.push({
                    id: genId(),
                    name: file.name,
                    mimeType: file.type,
                    data: base64Data
                });
                resolve();
            };
        });
        reader.readAsDataURL(file);
        await promise;
    }

    const option = state.options.find(o => o.id === optionId);
    if (option) {
        updateOption(optionId, { attachments: [...option.attachments, ...newAttachments] });
    }
  };

  // Main Action
  const handleAnalyze = async () => {
    setStep(4);
    setError(null);
    try {
        const result = await analyzeDecision(state);
        updateState({ result });
        setStep(5);
    } catch (e: any) {
        setError(e.message || "Sherlock encountered an error analyzing the evidence.");
        setStep(3);
    }
  };

  // Renders
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-amber-500/30 selection:text-amber-200 pb-20">
      
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
           <div className="flex items-center gap-2 cursor-pointer" onClick={() => setStep(0)}>
               <Search className="w-6 h-6 text-amber-500" />
               <h1 className="text-xl font-bold serif tracking-tight text-slate-100">
                 Decision <span className="text-amber-500">Sherlock</span>
               </h1>
           </div>
           <div className="text-xs font-mono text-slate-500">v1.0 • Gemini 2.5</div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pt-10">
        
        {/* Step 0: Intro */}
        {step === 0 && (
            <div className="flex flex-col items-center text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="relative">
                    <div className="absolute -inset-4 bg-amber-500/20 blur-xl rounded-full"></div>
                    <Scale className="w-24 h-24 text-amber-500 relative z-10" />
                </div>
                <div className="space-y-4 max-w-2xl">
                    <h2 className="text-4xl md:text-5xl font-bold serif text-slate-100">The game is afoot.</h2>
                    <p className="text-lg text-slate-400">
                        Upload your options—job offers, apartment listings, contracts—and set your criteria. 
                        Sherlock will analyze the evidence, weigh the pros and cons, and deduce the optimal choice.
                    </p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl mt-8">
                    {TEMPLATES.map(t => (
                        <button 
                          key={t.label} 
                          onClick={() => applyTemplate(t)}
                          className="flex flex-col items-center justify-center p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-800 transition-all group"
                        >
                            <t.icon className="w-8 h-8 text-slate-500 group-hover:text-amber-500 mb-3 transition-colors" />
                            <span className="font-medium text-slate-300">{t.label}</span>
                        </button>
                    ))}
                </div>
                
                <div className="relative py-4 w-full max-w-md">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-950 px-2 text-slate-500">Or start fresh</span></div>
                </div>

                <Button size="lg" className="w-full max-w-md h-12 text-base" onClick={() => { setState(INITIAL_STATE); setStep(1); }}>
                    Start New Investigation
                </Button>
            </div>
        )}

        {/* Step 1: Case File */}
        {step === 1 && (
            <Card className="animate-in slide-in-from-right-4 duration-300">
                <CardHeader>
                    <CardTitle>Step 1: The Case File</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <Label>Decision Title</Label>
                        <Input 
                            placeholder="e.g. Choosing a new car" 
                            value={state.title} 
                            onChange={e => updateState({ title: e.target.value })}
                            autoFocus
                        />
                    </div>
                    <div>
                        <Label>Context / Background (Optional)</Label>
                        <Textarea 
                            placeholder="Describe your situation. Are you budget conscious? Do you hate commuting?" 
                            value={state.description} 
                            onChange={e => updateState({ description: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end pt-4">
                        <Button onClick={() => setStep(2)} disabled={!state.title}>
                            Next: Define Criteria <ChevronRight className="ml-2 w-4 h-4"/>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )}

        {/* Step 2: Criteria */}
        {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <Card>
                    <CardHeader>
                        <CardTitle>Step 2: What Matters?</CardTitle>
                        <p className="text-slate-400 text-sm">Define your criteria and rate their importance from 1 (Low) to 10 (Critical).</p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {state.criteria.map((c, idx) => (
                            <div key={c.id} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                                <div className="flex-1 w-full space-y-2">
                                   <Input 
                                      value={c.name}
                                      placeholder="Criterion Name (e.g. Price)"
                                      onChange={e => updateCriteria(c.id, { name: e.target.value })}
                                      className="font-medium bg-transparent border-transparent focus:bg-slate-900 focus:border-slate-700 px-0"
                                   />
                                   <div className="flex items-center gap-2">
                                     <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Importance</span>
                                     <Slider 
                                       value={c.weight} 
                                       onChange={val => updateCriteria(c.id, { weight: val })} 
                                       className="flex-1"
                                     />
                                   </div>
                                </div>
                                <button 
                                  onClick={() => removeCriteria(c.id)} 
                                  className="text-slate-600 hover:text-red-400 p-2"
                                  disabled={state.criteria.length <= 1}
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                        
                        <Button variant="secondary" onClick={addCriteria} className="w-full border-dashed">
                            <Plus className="w-4 h-4 mr-2" /> Add Criterion
                        </Button>

                        <div className="flex justify-between pt-6 border-t border-slate-800">
                            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                            <Button onClick={() => setStep(3)} disabled={state.criteria.some(c => !c.name)}>
                                Next: Add Suspects <ChevronRight className="ml-2 w-4 h-4"/>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )}

        {/* Step 3: Options */}
        {step === 3 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center mb-4">
                   <h2 className="text-2xl font-bold serif text-slate-100">Step 3: The Suspects</h2>
                   <Button variant="secondary" onClick={addOption} size="sm"><Plus className="w-4 h-4 mr-2"/> Add Option</Button>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    {state.options.map((opt, idx) => (
                        <Card key={opt.id} className="relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50"></div>
                            <CardHeader className="pb-2 flex flex-row justify-between items-start">
                                <div className="space-y-1 w-full max-w-md">
                                    <Input 
                                      value={opt.name}
                                      onChange={e => updateOption(opt.id, { name: e.target.value })}
                                      className="text-lg font-bold bg-transparent border-none px-0 h-auto focus:ring-0 placeholder:text-slate-600"
                                      placeholder="Option Name"
                                    />
                                </div>
                                <button onClick={() => removeOption(opt.id)} className="text-slate-600 hover:text-red-400 disabled:opacity-30" disabled={state.options.length <= 2}>
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea 
                                    placeholder="Paste job description, apartment details, or contract text here..."
                                    value={opt.description}
                                    onChange={e => updateOption(opt.id, { description: e.target.value })}
                                    className="min-h-[100px] font-mono text-xs leading-relaxed"
                                />
                                
                                <div className="flex flex-col gap-3">
                                   <Label className="text-xs uppercase tracking-wider text-slate-500">Evidence (Images/PDFs)</Label>
                                   <div className="flex flex-wrap gap-2">
                                       {opt.attachments.map(att => (
                                           <div key={att.id} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full text-xs text-slate-300 border border-slate-700">
                                               <span className="truncate max-w-[150px]">{att.name}</span>
                                               <button onClick={() => updateOption(opt.id, { attachments: opt.attachments.filter(a => a.id !== att.id) })}>
                                                   <X className="w-3 h-3 hover:text-red-400" />
                                               </button>
                                           </div>
                                       ))}
                                       <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600 border-dashed text-xs text-slate-400 transition-colors">
                                           <Upload className="w-3 h-3" />
                                           Upload Files
                                           <input 
                                               type="file" 
                                               className="hidden" 
                                               multiple 
                                               accept="image/*,application/pdf"
                                               onChange={(e) => handleFileUpload(opt.id, e.target.files)}
                                           />
                                       </label>
                                   </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {error && (
                    <div className="p-4 bg-red-900/20 border border-red-900/50 rounded-lg text-red-300 text-sm flex items-center gap-2 animate-in shake">
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                        {error}
                    </div>
                )}

                <div className="flex justify-between pt-6 border-t border-slate-800">
                    <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                    <Button 
                        onClick={handleAnalyze} 
                        size="lg"
                        className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border-none shadow-lg shadow-amber-900/20"
                        disabled={state.options.some(o => !o.name)}
                    >
                        <Search className="mr-2 w-5 h-5" /> Analyze Evidence
                    </Button>
                </div>
            </div>
        )}

        {/* Step 4: Loading */}
        {step === 4 && (
            <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-700">
                <Loader2 className="w-16 h-16 text-amber-500 animate-spin mb-8" />
                <h3 className="text-2xl font-serif text-slate-100 mb-2">Sherlock is Thinking...</h3>
                <p className="text-slate-400 animate-pulse">Analyzing evidence • Comparing criteria • Deducing logic</p>
            </div>
        )}

        {/* Step 5: Results */}
        {step === 5 && (
            <AnalysisView 
                state={state} 
                onReset={() => { setState(INITIAL_STATE); setStep(0); }}
                onBack={() => setStep(3)}
            />
        )}

      </main>
    </div>
  );
}
