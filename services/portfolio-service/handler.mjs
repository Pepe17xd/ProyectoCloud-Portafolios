import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { claims, authorize, reply, parse, validate, key, uuid, sanitize, decodeCursor, assertRelatedEntity } from '@cloudportfolio/shared';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', ...(process.env.DYNAMODB_ENDPOINT ? {credentials:{accessKeyId:'local',secretAccessKey:'local'}} : {}) }));
const sns = new SNSClient({});
const table = process.env.TABLE_NAME;
const fields = ["name", "description", "ownerId", "status"];
const required = ["name"];
const resource = 'portfolios';
const present = (item) => item ? { ...item, id: item.id || String(item.sk || '').replace(/^ITEM#/, '') } : item;
export async function api(event) {
  try {
    const {tenantId,userId,role} = claims(event);
    const method=event.requestContext?.http?.method;
    authorize(role,method,resource);
    const path=event.rawPath || event.path || '/portfolios';
    const segments=path.split('/').filter(Boolean);
    const id=segments[1];
    const objective=segments[2]==='objectives';
    const objectiveId=segments[3];
    const objKey=(portfolioId,oid)=>({pk:`TENANT#${tenantId}`,sk:`OBJECTIVE#${portfolioId}#${oid}`});
    if(objective){
      const parent=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      if(!parent.Item)return reply(404,{error:'Portfolio not found'});
      if(method==='GET' && !objectiveId){const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':`TENANT#${tenantId}`,':prefix':`OBJECTIVE#${id}#`},Limit:Math.min(Math.max(Number(event.queryStringParameters?.limit)||50,1),100),ExclusiveStartKey:decodeCursor(event.queryStringParameters?.cursor,tenantId)}));return reply(200,{items:result.Items||[],nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null});}
      if(method==='POST' && !objectiveId){const body=parse(event);validate(body,['name']);const oid=uuid();const item={...objKey(id,oid),id:oid,portfolioId:id,name:body.name,description:body.description||'',status:body.status||'ACTIVE',createdBy:userId,createdAt:new Date().toISOString()};await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}));return reply(201,item);}
      if(method==='GET' && objectiveId){const result=await db.send(new GetCommand({TableName:table,Key:objKey(id,objectiveId)}));return result.Item?reply(200,result.Item):reply(404,{error:'Not found'});}
      if(method==='PATCH' && objectiveId){const result=await db.send(new GetCommand({TableName:table,Key:objKey(id,objectiveId)}));if(!result.Item)return reply(404,{error:'Not found'});const item={...result.Item,...sanitize(parse(event),['name','description','status']),updatedAt:new Date().toISOString()};await db.send(new PutCommand({TableName:table,Item:item}));return reply(200,item);}
      if(method==='DELETE' && objectiveId){const result=await db.send(new DeleteCommand({TableName:table,Key:objKey(id,objectiveId),ReturnValues:'ALL_OLD'}));return result.Attributes?reply(200,{deleted:true}):reply(404,{error:'Not found'});}
      return reply(405,{error:'Method not allowed'});
    }
    if(method==='GET' && !id){
      const data=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':`TENANT#${tenantId}`,':prefix':'ITEM#'},Limit:Math.min(Math.max(Number(event.queryStringParameters?.limit)||50,1),100),ExclusiveStartKey:decodeCursor(event.queryStringParameters?.cursor,tenantId)}));
      return reply(200,{items:(data.Items||[]).map(present),nextCursor:data.LastEvaluatedKey?Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64url'):null});
    }
    if(method==='GET'){
      const data=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      return data.Item?reply(200,present(data.Item)):reply(404,{error:'Not found'});
    }
    if(method==='POST'){
      const body=parse(event);validate(body,required);
      if (body.ownerId) await assertRelatedEntity(process.env.IDENTITY_API_URL, `users/${encodeURIComponent(body.ownerId)}`, event, 'User profile');
      const id=uuid();
      const item={...key(tenantId,id),id,...sanitize(body,fields),createdBy:userId,createdAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk) AND attribute_not_exists(sk)'}));
      if(resource==='projects' && process.env.TOPIC_ARN){
        await sns.send(new PublishCommand({TopicArn:process.env.TOPIC_ARN,Message:JSON.stringify({eventId:uuid(),eventType:'ProjectCreated',tenantId,entityId:item.sk.slice(5),occurredAt:new Date().toISOString(),version:1}),MessageAttributes:{eventType:{DataType:'String',StringValue:'ProjectCreated'}}}));
      }
      return reply(201,present(item));
    }
    if(method==='PATCH'){
      const body=sanitize(parse(event),fields);
      if (body.ownerId) await assertRelatedEntity(process.env.IDENTITY_API_URL, `users/${encodeURIComponent(body.ownerId)}`, event, 'User profile');
      const old=await db.send(new GetCommand({TableName:table,Key:key(tenantId,id)}));
      if(!old.Item)return reply(404,{error:'Not found'});
      const item={...old.Item,...body,updatedAt:new Date().toISOString()};
      await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_exists(pk) AND attribute_exists(sk)'}));
      return reply(200,present(item));
    }
    if(method==='DELETE'){
      await db.send(new DeleteCommand({TableName:table,Key:key(tenantId,id)}));
      return reply(200,{deleted:true});
    }
    return reply(405,{error:'Method not allowed'});
  }catch(e){console.error(e);return reply(e.status||500,{error:e.status?e.message:'Internal server error'});}
}
