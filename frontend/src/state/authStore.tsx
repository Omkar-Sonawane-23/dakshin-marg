/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type Role = 'ADMIN'|'VOYAGE_PLANNER'|'BRIDGE_OFFICER'|'ICE_PILOT'|'SCIENTIST'|'VIEWER';

interface User { id:string; name:string; role:Role; }

interface AuthShape {
  user: User | null;
  login: (name:string, role:Role)=>void;
  logout: ()=>void;
  hasRole: (r:Role)=>boolean;
}

const Ctx = createContext<AuthShape|null>(null);

const MOCK_USERS: User[] = [
  { id:'U-01', name:'Dr. A. Nair', role:'VOYAGE_PLANNER' },
  { id:'U-02', name:'Capt. R. Singh', role:'BRIDGE_OFFICER' },
  { id:'U-03', name:'Ice Pilot K. Larsen', role:'ICE_PILOT' },
  { id:'U-04', name:'Admin', role:'ADMIN' },
];

export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(MOCK_USERS[0]);
  const value = useMemo<AuthShape>(()=>({
    user,
    login:(name,role)=>setUser({id:`U-${Date.now()}`, name, role}),
    logout:()=>setUser(null),
    hasRole:(r)=> user ? (user.role===r || user.role==='ADMIN') : false,
  }), [user]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(){
  const v=useContext(Ctx);
  if(!v) throw new Error('useAuth outside');
  return v;
}
export const ROLES: Role[] = ['ADMIN','VOYAGE_PLANNER','BRIDGE_OFFICER','ICE_PILOT','SCIENTIST','VIEWER'];
