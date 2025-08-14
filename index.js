const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');

// ===== Servidor HTTP para Always On =====
const app = express();
app.get('/', (req, res) => res.send('Bot está online!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor HTTP rodando na porta ${PORT}`)) 
// =======================================

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    client.login(token);
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const userGenerationSchema = new mongoose.Schema({
  userId: String,
  date: String,
  count: Number
});

// Adicionando o terceiro parâmetro com o nome exato da collection
const UserGeneration = mongoose.model('UserGeneration', userGenerationSchema, 'usersGenerationsCap');

const token = process.env.TOKEN; 
const apiKey = process.env.API_KEY;
const userGenerations = {};


client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

    const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    const userId = message.author.id;

    // Fetch user from DB
    let user = await UserGeneration.findOne({ userId });

    if (!user || user.date !== today) {
      // First time today or new user
      if (!user) {
        user = new UserGeneration({ userId, date: today, count: 0 });
      } else {
       user.date = today;
        user.count = 0;
      }
      await user.save();
}

if (user.count >= 3) {
  message.reply('❌ You’ve reached your daily limit of 3 generations.');
  return;
}

  const [command, code] = message.content.trim().split(' ');

  if (message.channel.name === 'users-gen') {
    if (command === '!generate') {
  const args = message.content.trim().split(/\s+/);

  if (args.length < 5) {
    message.reply('Use: `!generate <style> <gender> <sfw:true|false> <prompt>`');
    return;
  }

  const style = args[1];
  const gender = args[2];
  const sfw = args[3].toLowerCase() === 'true';
  const prompt = args.slice(4).join(' ');

  try {
    // Passo 1: Envia requisição de geração da foto
    const generationResponse = await axios.post(
      'https://lovescape.com/api/external/v1/photo-generation',
      {
        promptType: 'no_character',
        style,
        gender,
        sfw,
        batchSize: 1,
        storyPrompt: prompt
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Generation request success:', generationResponse.data);

    const taskId = generationResponse.data.mediaGenerationTaskIds?.[0];
    if (!taskId) {
      throw new Error('No task ID returned.');
    }

    const waitMsg = await message.reply(`⏳ Generating image...`);

    // Passo 2: Polling para verificar se a imagem está pronta
    let result = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(res => setTimeout(res, 4000)); // espera 4s (total ~2min máx)

      try {
        const resultRes = await axios.get(
          `https://lovescape.com/api/external/v1/generations/${taskId}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            }
          }
        );

        const media = resultRes.data.medias?.[0];

        if (media && media.status === 'ready') {
          await new Promise(res => setTimeout(res, 3000)); // espera 3s extra
          result = media.url;
          const mediaId = media.id;  // pega o mediaId aqui
          console.log('📸 Final media URL:', result); 
          console.log('🆔 Media ID:', mediaId);

          // Apaga mensagem de espera e envia imagem + mediaId
          await waitMsg.delete().catch(() => {});
          // Faz download da imagem
          const imageResponse = await axios.get(result, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(imageResponse.data, 'binary');

          const filePath = path.join(__dirname, 'temp_image.jpg');
          fs.writeFileSync(filePath, buffer);

          await message.reply({
            content: `✅ Generated image (Media ID: \`${mediaId}\`):`,
            files: [filePath],
          });

          user.count++;
          await user.save();


          // Remove o arquivo temporário
          fs.unlinkSync(filePath);

          break;
        }
      } catch (error) {
        if (
          error.response?.data?.error === 'Entity is being created, try again later.'
        ) {
          console.log('⏳ Still processing...');
          continue;
        } else {
          console.error('❌ Unexpected error during polling:', error.response?.data || error.message);
          break;
        }
      }
    }

    if (!result) {
      await waitMsg.edit('❌ Generation timed out or failed.');
    }
    } catch (error) {
      console.error('❌ Error during image generation:', error);
      message.reply('❌ Error during image generation.');
    }
  }else if (command === '!generate-video') {
  const args = message.content.trim().split(/\s+/);

  if (args.length < 4) {
    message.reply('Use: `!generate-video <mediaId> <action> <prompt>`');
    return;
  }

  const mediaId = parseInt(args[1], 10);
  if (isNaN(mediaId)) {
    message.reply('O <mediaId> deve ser um número válido.');
    return;
  }

  const actions = [args[2]];
  const prompt = args.slice(3).join(' ');

  try {
    // Envia pedido para gerar vídeo
    const videoGenResponse = await axios.post(
      'https://lovescape.com/api/external/v1/video-generation',
      {
        mediaId,
        actions,
        prompt,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const taskIds = videoGenResponse.data.mediaGenerationTaskIds;
    if (!taskIds || taskIds.length === 0) {
      message.reply('❌ Nenhum taskId retornado para geração de vídeo.');
      return;
    }
    const taskId = taskIds[0];

    const waitMsg = await message.reply('⏳ Gerando vídeo...');

    // Polling para o vídeo ficar pronto
    let resultUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(res => setTimeout(res, 4000));

      try {
        const statusResponse = await axios.get(
          `https://lovescape.com/api/external/v1/generations/${taskId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        const media = statusResponse.data.medias?.[0];
        if (media && media.status === 'ready' && media.type === 'video') {
          await new Promise(res => setTimeout(res, 3000));
          resultUrl = media.url;
          break;
        }
      } catch (error) {
        if (error.response?.data?.error === 'Entity is being created, try again later.') {
          continue;
        } else {
          console.error('Erro no polling do vídeo:', error.response?.data || error.message);
          break;
        }
      }
    }

    if (resultUrl) {
      await waitMsg.edit(`✅ Vídeo gerado com sucesso: ${resultUrl}`);
      user.count++;
      await user.save();

    } else {
      await waitMsg.edit('❌ Tempo esgotado ou falha na geração do vídeo.');
    }
  } catch (error) {
    console.error('Erro na geração do vídeo:', error);
    message.reply('❌ Erro ao gerar vídeo.');
  }
}
  }
});
