import React, { createContext, useContext } from 'react';
const AuthContext = createContext(null);
const user = {id:'local-user',full_name:'本地用户',email:'local@localhost',role:'user'};
const value = {user,isAuthenticated:true,isLoadingAuth:false,isLoadingPublicSettings:false,authError:null,authChecked:true,appPublicSettings:{id:'local',public_settings:{}},logout:()=>window.location.assign('/'),navigateToLogin:()=>window.location.assign('/'),checkUserAuth:async()=>user,checkAppState:async()=>{}};
export function AuthProvider({children}) {return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;}
export const useAuth = () => useContext(AuthContext);
