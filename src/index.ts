import Sqlite3RepositoryAdapter from "./adapters/sqlite3RepositoryAdapter";
import RedisEventBussAdapter from "./adapters/redisEventBussAdapter";
import WppConnectAdapter from "./adapters/wppConnectAdapter";
import RedisStoreAdapter from "./adapters/redisStoreAdapter";
import wppConnectConfig from "./config/wppConnectConfig"
import OpenAiCompletitionsAdapter from "./adapters/openAi/openAiCompletitionsAdapter"
import OpenAiTranscriptionsAdapter from "./adapters/openAi/openAiTranscriptionsAdapter";
import OpenAiUsageAdapter from "./adapters/openAi/openAiUsageAdapter";
import OpenAiVisionAdapter from "./adapters/openAi/openAiVisionAdapter";
import * as wppconnect from '@wppconnect-team/wppconnect';
import sqlite3Config from "./config/sqlite3-config";
import redisConfig from './config/redisConfig'
import openAiConfig from "./config/openAi.config";
import Redis from "ioredis";
import OpenAI from 'openai';



import { MessageFactory } from "./domain/entites/messageFactory";
import { EventBussPort } from "./ports/EventBussPort";
import { StorePort } from "./ports/StorePort";
import { open } from 'sqlite';
import generateBalanceResponse from "./domain/ai/functions/generateBalanceResponse";
import generateImageResponse from "./domain/ai/functions/generateImageResponse";
import handleMisunderstanding from "./domain/ai/functions/handleMisunderstanding";
import Message from "./domain/entites/message";
import AiService from "./application/AiService";
import { GenerateImageResponseExecutor } from "./domain/ai/functions/GenerateImageResponseExecutor";
import GenerateBalanceResponseExecutor from "./domain/ai/functions/GenerateBalanceResponseExecutor";

import DefaultMessages from "./domain/errors/errorMessages";
import HandleMisunderstandingExecutor from "./domain/ai/functions/HandleMisunderstandingExecutor";
import { stat } from "fs";

const defaultMessages = new DefaultMessages()

const redisPublisher = new Redis(redisConfig)
const redisSubscriber = new Redis(redisConfig)
const eventBuss: EventBussPort = new RedisEventBussAdapter( redisPublisher, redisSubscriber)
const storePort: StorePort = new RedisStoreAdapter(redisPublisher)


const db = await open(sqlite3Config);
const messageRepository = new Sqlite3RepositoryAdapter(db)
const usageRepository = new Sqlite3RepositoryAdapter(db)
await messageRepository.CreateTables()


const openAi = new OpenAI(openAiConfig.credentials);
const functions = [generateBalanceResponse, generateImageResponse, handleMisunderstanding]
const aiUsagePort = new OpenAiUsageAdapter(openAiConfig.pricing_rules)
const aiTranscriptionPort = new OpenAiTranscriptionsAdapter(openAi, aiUsagePort)
const aiCompletitionsPort = new OpenAiCompletitionsAdapter(openAi, aiUsagePort, functions)
const aiVisionPort = new OpenAiVisionAdapter(openAi, aiCompletitionsPort, aiUsagePort)


const messageFactory = new MessageFactory(aiTranscriptionPort, messageRepository, usageRepository, defaultMessages)


const wppConnectClient = await wppconnect.create(wppConnectConfig);
const messagePort = new WppConnectAdapter(wppConnectClient, messageFactory, storePort, eventBuss)


const generateImageResponseExecutor = new GenerateImageResponseExecutor(messagePort, messageFactory, aiVisionPort, usageRepository, messageRepository )
const generateBalanceResponseExecutor = new GenerateBalanceResponseExecutor(usageRepository, messageRepository, messagePort,  messageFactory )
const handleMisunderstandingExecutor = new HandleMisunderstandingExecutor(messageRepository, messagePort, messageFactory)

const aiService = new AiService(aiCompletitionsPort,messageRepository,usageRepository,messagePort,messageFactory, storePort, [
  generateImageResponseExecutor,
  generateBalanceResponseExecutor,
  handleMisunderstandingExecutor
])


messagePort.onPresenceChanged(async state => {
  try {
    await eventBuss.emitPresenceStateDebounced(state, 3)
  }
  
  catch(error) {
    console.error('index.messagePort.onPresenceChanged', error)
  }
})

messagePort.onMessageReceived(async (message: Message): Promise<void> => {
  try {
    await eventBuss.enqueueMessage(message)
    await messageRepository.saveMessage(message)
    await eventBuss.emitPresenceStateDebounced({chatId: message.chatId, state: 'unavailable'}, 3)
  } 
  
  catch(error) {
    console.error('index.messagePort.onMessageReceived', error)
  }
})



eventBuss.onPresenceStateDebounced(async currentState => {
  try {
    const messageCount = await eventBuss.getMessagesCount(currentState.chatId)
    if(currentState.state === 'unavailable' && messageCount > 0 ) {
      await aiService.HandleMessageReceived(currentState.chatId)
    }
  }

  catch (error) {
    console.error('index.eventBuss.onPresenceStateDebounced', error)
  }
})


eventBuss.onMessageSent(async (message: Message) => {
  try{
    await messageRepository.saveMessage(message)
    await messageRepository.markMessagesAsReplied(message.chatId)
    await storePort.deleteUntil(message.chatId, message.timestamp)
  }
  
  catch(error){
    console.error('index.eventBuss.onMessageSent.error', error)
  }
})













