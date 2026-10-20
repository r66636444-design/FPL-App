import { NextRequest, NextResponse } from 'next/server';
import { bootstrap } from '@/lib/fpl';
import { getNews } from '@/lib/news';
export const dynamic='force-dynamic';

/** Invoke with Authorization: Bearer $CRON_SECRET from a trusted scheduler.
 * Database and credentials are optional for the core website, required for ingestion.
 */
export async function GET(request:NextRequest){
  if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'DATABASE_URL required for persistent ingestion'},{status:503});
  try{
    const data=await bootstrap();
    const articles=await getNews(data.elements,data.teams,true);
    if(!articles.length)return NextResponse.json({error:'No source articles available; nothing stored.'},{status:503});
    const {PrismaClient}=await import('@prisma/client');
    const prisma=new PrismaClient();
    try {
      await prisma.footballNews.createMany({data:articles.map(article=>({url:article.url,title:article.title,source:article.source,publishedAt:new Date(article.published),description:article.description,teams:article.teams,playerIds:article.playerIds})),skipDuplicates:true});
      await prisma.ingestionRun.create({data:{provider:'rss',count:articles.length,finishedAt:new Date()}});
      return NextResponse.json({stored:articles.length,updatedAt:new Date().toISOString()});
    }finally{await prisma.$disconnect()}
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Ingestion failed'},{status:503});}
}