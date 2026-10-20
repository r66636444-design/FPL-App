import { NextRequest, NextResponse } from 'next/server';
import { getPublicTeam } from '@/lib/team';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  const raw=request.nextUrl.searchParams.get('id');
  if (!raw || !/^\d{1,9}$/.test(raw) || Number(raw)<1) return NextResponse.json({error:'Enter a valid numeric FPL manager ID.'},{status:400});
  try {return NextResponse.json(await getPublicTeam(Number(raw)),{headers:{'Cache-Control':'private, max-age=60'}});}
  catch (error) {return NextResponse.json({error:error instanceof Error?error.message:'Could not import FPL team'},{status:502});}
}