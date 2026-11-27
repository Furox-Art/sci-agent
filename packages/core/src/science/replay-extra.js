// Alternative implementations for bounded, immutable scientific inputs.
// A disagreement is reported rather than adjusting tolerance to make it pass.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const assert=(x,msg)=>{if(!x)throw new Error(msg);};
const numberToken='[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
function scalar(original,value,digits,metric){
  const rounded=finite(value)?Number(value.toPrecision(digits)):NaN;
  return {metric,original:finite(original)?original:null,reproduced:finite(value)?value:null,rounded:finite(rounded)?rounded:null,pass:finite(original)&&finite(rounded)&&original===rounded};
}
function matrix(a,max=10){
  return Array.isArray(a)&&a.length>=1&&a.length<=max&&Array.isArray(a[0])&&a[0].length>=1&&a[0].length<=max&&a.every(r=>Array.isArray(r)&&r.length===a[0].length&&r.every(finite));
}
function det(a){
  if(!a.length)return 1;
  return a[0].reduce((s,v,j)=>s+(j%2?-1:1)*v*det(a.slice(1).map(row=>row.filter((_,k)=>j!==k))),0);
}
function readMatrix(output,rows,cols){
  const lines=output.split('\n');
  const values=lines.slice(1,-1).map(line=>{try{return JSON.parse(line);}catch{return null;}});
  const literal=lines.at(-1)?.match(/^matrix = (\[.*\])$/)?.[1];
  let other;try{other=JSON.parse(literal);}catch{}
  const valid=m=>matrix(m)&&m.length===rows&&m[0].length===cols;
  return valid(values)&&valid(other)?{values,other}:null;
}
// Stack-based infix evaluation, separate from the original recursive parser.
// Supported grammar is decimal/scientific literals, parentheses and + - * /.
function stackEvaluate(expression){
  if(typeof expression!=='string'||expression.length>500)return null;
  const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()+*/-]|\s+/g)??[];
  if(tokens.join('')!==expression)return null;
  const vals=[],ops=[],prec={'+':1,'-':1,'*':2,'/':2,'u+':3,'u-':3};
  let expect=true;
  const apply=()=>{
    const op=ops.pop(),b=vals.pop();
    if(b===undefined)throw new Error('Invalid arithmetic');
    if(op==='u+'||op==='u-'){vals.push(op==='u-'?-b:b);return;}
    const a=vals.pop();if(a===undefined)throw new Error('Invalid arithmetic');
    vals.push(op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:a/b);
  };
  for(const t of tokens){
    if(/^\s+$/.test(t))continue;
    if(/^\d|^\.\d/.test(t)){if(!expect)return null;vals.push(Number(t));expect=false;continue;}
    if(t==='('){if(!expect)return null;ops.push(t);continue;}
    if(t===')'){if(expect)return null;while(ops.length&&ops.at(-1)!=='(')apply();if(ops.pop()!=='(')return null;expect=false;continue;}
    if(expect){if(!['+','-'].includes(t))return null;ops.push('u'+t);continue;}
    while(ops.length&&ops.at(-1)!=='('&&prec[ops.at(-1)]>=prec[t])apply();
    ops.push(t);expect=true;
  }
  if(expect)return null;
  while(ops.length){if(ops.at(-1)==='(')return null;apply();}
  return vals.length===1&&finite(vals[0])?vals[0]:null;
}
// Direct conversion ratios from separate SI definitions, canonical symbols only.
const groups=[
  {mm:1,cm:10,m:1000,km:1e6,in:25.4,ft:304.8,yd:914.4,mi:1609344},
  {mg:1,g:1000,kg:1e6,t:1e9,lb:453592.37,oz:28349.523125},
  {ms:1,s:1000,min:60000,h:3600000,d:86400000},
  {J:1,kJ:1000,cal:4.184,kcal:4184,eV:1.602176634e-19,Wh:3600,kWh:3600000},
  {Pa:1,kPa:1000,bar:100000,atm:101325,mmHg:133.322387415},
  {deg:1,rad:180/Math.PI,grad:0.9},
];
function convert(v,a,b){
  if(!finite(v)||typeof a!=='string'||typeof b!=='string')return null;
  if(['C','K','F'].includes(a)&&['C','K','F'].includes(b)){
    if(a===b)return v;
    const formulas={'C:K':()=>v+273.15,'K:C':()=>v-273.15,'C:F':()=>v*1.8+32,'F:C':()=>(v-32)/1.8,'K:F':()=>v*1.8-459.67,'F:K':()=>(v+459.67)/1.8};
    return formulas[a+':'+b]();
  }
  const g=groups.find(x=>Object.hasOwn(x,a)&&Object.hasOwn(x,b));
  return g?v*(g[a]/g[b]):null;
}
export function extraReplay({tool,args,output}){
  if(tool==='matrix_ops'&&['multiply','inverse'].includes(args?.op)){
    const a=args.a,b=args.b;
    assert(matrix(a),'Invalid inline matrix');
    let expected,algorithm;
    if(args.op==='multiply'){
      assert(matrix(b)&&a[0].length===b.length,'Invalid multiplication dimensions');
      expected=Array.from({length:a.length},()=>Array(b[0].length).fill(0));
      for(let k=0;k<b.length;k++)for(let i=0;i<a.length;i++)for(let j=0;j<b[0].length;j++)expected[i][j]+=a[i][k]*b[k][j];
      algorithm='Outer-product accumulation';
    }else{
      if(a.length!==a[0].length||a.length>7)return null;
      const d=det(a);if(!finite(d)||d===0)return null;
      expected=a.map((row,i)=>row.map((_,j)=>(i+j)%2?-det(a.filter((_,r)=>r!==j).map(r=>r.filter((_,c)=>c!==i)))/d:det(a.filter((_,r)=>r!==j).map(r=>r.filter((_,c)=>c!==i)))/d));
      algorithm='Adjugate/cofactor inverse';
    }
    const actual=output.startsWith(args.op==='multiply'?'product:\n':'inverse matrix:\n')?readMatrix(output,expected.length,expected[0].length):null;
    const comparisons=expected.flatMap((r,i)=>r.flatMap((v,j)=>{
      const display=scalar(actual?.values[i][j],v,10,'matrix['+i+','+j+']');
      // The original JSON matrix field has a documented 12-digit formatter and
      // sub-1e-12 cleaning. Check both renderings rather than trusting one.
      const literal=scalar(actual?.other[i][j],Math.abs(v)<1e-12?0:v,12,'literal['+i+','+j+']');
      return [display,literal];
    }));
    return {algorithm,comparisons};
  }
  if(tool==='math_eval'){
    const v=stackEvaluate(args?.expression?.trim());
    if(v===null)return null;
    const src=args.expression.trim(), prefix=src+' = ';
    const suffix=output.startsWith(prefix)?output.slice(prefix.length).match(new RegExp('^('+numberToken+')$')):null;
    return {algorithm:'Shunting-yard operator stack',comparisons:[scalar(suffix?Number(suffix[1]):NaN,v,12,'expression')]};
  }
  if(tool==='unit_convert'){
    const v=convert(args?.value,args?.from,args?.to);
    if(v===null)return null;
    const [left,right,...rest]=output.split(' = '),m=right?.match(new RegExp('^('+numberToken+') (.+)$')),l=left?.match(new RegExp('^('+numberToken+') (.+)$'));
    const original=!rest.length&&l&&l[2]===args.from&&Number(l[1])===Number(args.value.toPrecision(10))&&m&&m[2]===args.to?Number(m[1]):NaN;
    return {algorithm:'Independent direct unit ratio / affine temperature formula',comparisons:[scalar(original,v,10,'converted_value')]};
  }
  if(tool==='research_uncertainty'){
    const g=args?.gradient,u=args?.standardUncertainties,k=args?.coverageFactor??2;
    assert(Array.isArray(g)&&Array.isArray(u)&&g.length===u.length&&g.length>0&&g.length<=50&&g.every(finite)&&u.every(x=>finite(x)&&x>=0)&&finite(k)&&k>0,'Invalid uncertainty inputs');
    const r=args.correlation??g.map((_,i)=>g.map((_,j)=>i===j?1:0));
    assert(Array.isArray(r)&&r.length===g.length&&r.every(row=>Array.isArray(row)&&row.length===g.length&&row.every(finite)),'Invalid correlation');
    let variance=0,absSum=0;
    for(let i=0;i<g.length;i++)for(let j=0;j<g.length;j++){
      const x=g[i]*u[i]*r[i][j]*g[j]*u[j];variance+=x;absSum+=Math.abs(x);
    }
    if(!finite(variance)||!finite(absSum)||variance<0&&Math.abs(variance)>1e-12*absSum)return null;
    variance=Math.max(0,variance);
    const std=Math.sqrt(variance),expected={variance,standardUncertainty:std,expandedUncertainty:k*std};
    // Original outputs full IEEE-754 precision; independent algebraic order
    // differs. Fixed relative tolerance plus a scale-aware roundoff bound.
    const comparisons=Object.entries(expected).map(([metric,v])=>{
      const line=output.split('\n').find(l=>l.startsWith(metric+' = '));
      const original=line?Number(line.slice(metric.length+3)):NaN;
      const bound=metric==='variance'?1e-12*absSum:1e-12*Math.abs(v);
      const tolerance=Math.max(bound,1e-12*Math.abs(v));
      return {metric,original:finite(original)?original:null,reproduced:v,tolerance,pass:finite(original)&&finite(v)&&Math.abs(original-v)<=tolerance};
    });
    return {algorithm:'Direct quadratic covariance form (independent of Cholesky factorization)',comparisons};
  }
  return null;
}
