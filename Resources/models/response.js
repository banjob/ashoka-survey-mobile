var _ = require('lib/underscore')._;
var Answer = require('models/answer');
var Record = require('models/record');
var Choice = require('models/choice');
var progressBarView = require('ui/common/components/ProgressBar');
var Response = new Ti.App.joli.model({
  table : 'responses',
  columns : {
    id : 'INTEGER PRIMARY KEY',
    user_id : 'INTEGER',
    organization_id : 'INTEGER',
    survey_id : 'INTEGER',
    web_id : 'INTEGER',
    status : 'TEXT',
    updated_at : 'TEXT',
    latitude : 'REAL',
    longitude : 'REAL',
    mobile_id : 'TEXT'
  },

  methods : {
    createRecord : function(surveyID, status, answersData, location) {
      var response = this.newRecord({
        survey_id : surveyID,
        user_id : Ti.App.Properties.getString('user_id'),
        organization_id : Ti.App.Properties.getString('organization_id'),
        status : status,
        updated_at : parseInt(new Date().getTime()/1000, 10),
        latitude : location.latitude,
        longitude : location.longitude,
        mobile_id : Titanium.Platform.createUUID()
      });
      response.save();
      response.updateOrCreateAnswers(answersData);
      // TODO: Fix this. By creating balnk answers, we are sending blank answers
      // for even mandatory questions to the server which causes response sync to fail.
      // response.createBlankAnswers();
      return true;
    },

    validate : function(answersData, status) {
      var errors = {};
      _(answersData).each(function(answerData) {
        var answerErrors = Answer.validate(answerData, status);
        if (!_.isEmpty(answerErrors)) {
          errors[answerData.question_id] = answerErrors;
        }
      });
      return errors;
    }
  },

  objectMethods : {
    prepRailsParams : function() {
      var answer_attributes = {};
      _(this.answers()).each(function(answer, index) {
        answer_attributes[index] = {};
        answer_attributes[index]['question_id'] = answer.question_id;
        answer_attributes[index]['updated_at'] = answer.updated_at;        
        if (answer.web_id)
          answer_attributes[index]['id'] = answer.web_id;
        if(answer.record_id) {
          var record = Record.findOneById(answer.record_id);
          answer_attributes[index]['record_id'] = record.web_id;
        }
        if (answer.hasChoices())
          answer_attributes[index]['option_ids'] = answer.optionIDs();
        else
          answer_attributes[index]['content'] = answer.content;
        if (answer.isImage() && answer.image){
          var image = Titanium.Filesystem.getFile(answer.image);
          answer_attributes[index]['photo'] = Ti.Utils.base64encode(image.read()).getText();
        }
      });
      return answer_attributes;
    },

    createBlankAnswers : function() {
      var self = this;
      var Survey = require('models/survey');
      var survey = Survey.findOneById(self.survey_id);
      _(survey.questions()).each(function(question) {
        var parentMR = question.parentMR();
        if(!parentMR) {
          var answer = self.answerForQuestion(question.id);
          if(!answer) {
            Answer.createRecord({content: '', question_id: question.id}, self.id);
          }
        } else {
          var records = self.recordsForMultiRecordCategory(parentMR.id);
          _(records).each(function(record) {
            var answer = self.answerForQuestion(question.id, record.id);
            if(!answer)
              Answer.createRecord({content: '', question_id: question.id, record_id: record.id}, self.id);
          });
        }
      });
    },

    updateOrCreateAnswers : function(answersData) {
      var self = this;
      var groupedAnswers = _(answersData).groupBy(function(answer) {
        return answer.record_id;
      });
      _(groupedAnswers).each(function(answersInRecord, recordID) {
        if(recordID === "undefined") { // Answers not belonging to a record
          _(answersInRecord).each(function(answerData) {
            var id = answerData.id;
            Answer.updateOrCreateById(id, answerData, self.id);
          });
        } else {
          var record = Record.findOneById(recordID);
          record.update(answersInRecord, self.id);
        }
      });
    },

    update : function(status, answersData) {
      Ti.API.info("updating response");
      var self = this;
      self.set('status', status);
      self.set('updated_at', parseInt(new Date().getTime() / 1000, 10));
      self.set('user_id', Ti.App.Properties.getString('user_id'));
      self.set('organization_id', Ti.App.Properties.getString('organization_id'));
      self.deleteObsoleteAnswers(answersData);

      self.updateOrCreateAnswers(answersData);

      self.save();
      Ti.App.fireEvent('updatedResponse');
      Ti.API.info("response updated at" + self.updated_at);
    },

    deleteObsoleteAnswers : function(answersData) {
      var answerIDs = _(answersData).map(function(answerData) {
        if (answerData.id)
          return answerData.id;
      });
      var obsoleteAnswers = _(this.unsortedAnswers()).select(function(answer) {
        Ti.API.info("answer id " + answer.id);
        return !_(answerIDs).include(answer.id);
      });
      _(obsoleteAnswers).each(function(answer) {
        answer.destroyChoices();
        answer.destroy();
      });
    },

    syncOnLoad : function(data) {
      Ti.API.info("Received response successfully: " + data.responseText);
      var self = data.response;
      self.destroyAnswers();

      var received_response = JSON.parse(data.responseText);

      // for complete response
      if (received_response['status'] === "complete" && received_response['mobile_id'] == self.mobile_id) {
        var surveyID = self.survey_id;
        var id = self.id;
        self.destroy();
        Ti.App.fireEvent('response.sync.' + id, {
          survey_id : surveyID,
          response_id : id
        });
        return;
      }

      // for incomplete response
      self.set('web_id', received_response['id']);
      self.set('status', received_response['status']);
      self.set('updated_at', parseInt(new Date(received_response['updated_at']).getTime()/1000, 10));
      self.save();

      _(received_response.answers).each(function(received_answer, index) {
        var file;
        if(received_answer.photo_in_base64) {
          var image = Ti.Utils.base64decode(received_answer.photo_in_base64);
          var filename = "image_" + (new Date()).valueOf() + ".jpg";
          file = Titanium.Filesystem.getFile(Titanium.Filesystem.applicationDataDirectory, filename);
          file.write(image);
        }

        var Question = require('models/question');
        var question = Question.findOneById(received_answer.question_id);

        var record;
        if(received_answer.record_id) {
          Ti.API.info("Record is i s: " + received_answer.record_id);
          record = Record.findOneBy('web_id', received_answer.record_id);
          if(!record) {
            record = Record.createRecord({
              'response_id' : self.id,
              'web_id' : received_answer.record_id,
              'category_id' :  question.parentMR().id
            });
          }
        }

        var new_answer = Answer.newRecord({
          'response_id' : self.id,
          'question_id' : received_answer.question_id,
          'web_id' : received_answer.id,
          'content' : received_answer.content,
          'record_id' : record ? record.id : null,
          'updated_at' : parseInt(new Date(received_answer.updated_at).getTime()/1000, 10),
          'image' : file && file.nativePath
        });
        new_answer.save();

        _(received_answer.choices).each(function(choice) {
          choice.answer_id = new_answer.id;
          Choice.newRecord(choice).save();
        });
      });

      Ti.App.fireEvent('response.sync.' + self.id, {
        survey_id : self.survey_id,
        has_error : false,
        response_id : self.id
      });

    },

    syncOnError : function(data) {
      var message;
      var self = data.response;
      var responseText = data.responseText;
      Ti.API.info("Error response with status " + data.status);
      if (data.status == '410') {// Response deleted on server
        Ti.API.info("Response deleted on server: " + responseText);
        self.destroyRecords();
        self.destroyAnswers();
        self.destroy();
      }
      Ti.App.fireEvent('response.sync.' + self.id , {
        survey_id : self.survey_id,
        has_error : true,
        response_id : self.id
      });
    },

    sync : function() {
      try {
        var url = Ti.App.Properties.getString('server_url') + '/api/responses';
        var self = this;
        var params = {
          answers_attributes : this.prepRailsParams(),
          status : this.status,
          survey_id : this.survey_id,
          updated_at : parseInt(new Date(this.updated_at).getTime(), 10),
          longitude : this.longitude,
          latitude : this.latitude,
          user_id : this.user_id,
          organization_id : this.organization_id,
          access_token : Ti.App.Properties.getString('access_token'),
          mobile_id : this.mobile_id
        };
      } catch(err) {
        alert(L("out_of_memory"));
        return null;
      }

      var client = Ti.Network.createHTTPClient({
        // function called when the response data is available

        onload : function() {
          Ti.API.info("onLoad Response");
          Ti.App.fireEvent('response:syncNextResponse' + self.survey_id);
          self.syncOnLoad({
            response : self,
            responseText : this.responseText
          });
        },
        onerror : function() {
          Ti.App.fireEvent('response:syncNextResponse' + self.survey_id);
          self.syncOnError({
            response : self,
            responseText : this.responseText,
            status : this.status
          });
        },
        timeout : 60000 // in milliseconds
      });

      var method = self.web_id ? "PUT" : "POST";
      url += self.web_id ? "/" + self.web_id : "";
      url += ".json";
      client.open(method, url);
      client.setRequestHeader("Content-Type", "application/json");
      client.send(JSON.stringify(params));
    },

    syncRecords : function() {
      var self = this;
      var recordCount = _(this.records()).size();

      if(recordCount === 0) {
        this.sync();
        return;
      }

      var successCount = 0;
      var errorCount = 0;

      var syncHandler = function(data) {
        Ti.API.info("got to sync handler");
        data.has_error ? errorCount++ : successCount++;
        if(successCount === recordCount) {
          self.sync();
        } else if ((successCount + errorCount) === recordCount) {
          // Error. Don't sync response.
          Ti.App.fireEvent('response.sync.' + self.id , {
            survey_id : self.survey_id,
            has_error : true,
            response_id : self.id
          });
        }
        Ti.App.removeEventListener('record.sync.' + data.id, syncHandler);
      };

      Ti.API.info("Syncing records");

      _(this.records()).each(function(record) {
        Ti.App.addEventListener('record.sync.' + record.id, syncHandler);
        record.sync();
      });
    },

    questions : function() {
      var Survey = require('models/survey');
      var survey = Survey.findOneById(this.survey_id);
      var firstLevelQuestions = survey.firstLevelQuestionsAndCategories();

        var questions = _.chain(firstLevelQuestions).map(function(question) {
        return question.withSubQuestions();
      }).flatten().value();

      return questions;
    },

    answers : function() {
      var answers = this.unsortedAnswers();
      var questionIDs = _(this.questions()).map(function(question) {
        return question.id;
      });
      var sortedAnswers = _(answers).sortBy(function(answer) {
        return questionIDs.indexOf(answer.question_id);
      });
      return sortedAnswers;
    },

    records : function() {
      return Record.findBy('response_id', this.id);
    },

    unsortedAnswers : function() {
      return Answer.findBy('response_id', this.id);
    },

    destroyAnswers : function() {
      _(this.unsortedAnswers()).each(function(answer) {
        answer.destroyAll();
      });
    },

    destroyRecords : function() {
      _(this.records()).each(function(record) {
        record.destroy();
      });
    },

    answerForQuestion : function(questionID, recordID) {
      var response = this;
      var answers = Ti.App.joli.models.get('answers').all({
        where: {
          'response_id = ?': response.id,
          'question_id = ?': questionID
        }
      });
      if(recordID) {
        answers = _(answers).filter(function(answer) {
          return answer.record_id === recordID;
        });
      }
      return answers[0];
    },

    recordsForMultiRecordCategory : function(multiRecordCategoryID) {
      var response = this;
      var records = Ti.App.joli.models.get('records').all({
        where: {
          'response_id = ?': response.id,
          'category_id = ?': multiRecordCategoryID
        }
      });
      return records;
    },

    hasImageAnswer : function() {
      return _(this.unsortedAnswers()).any(function(answer) {
        return (answer.isImage() && answer.image);
      });
    },

    identifierAnswers : function() {
      var identifiers = _(this.unsortedAnswers()).select(function(answer) {
        return answer.question().identifier;
      });
      if (_(identifiers).isEmpty()) {
        identifiers = this.answers().slice(0, 5);
      }
      return identifiers;

    },

    isComplete : function() {
      return this.status === "complete";
    },

    isNotComplete : function() {
      return !this.isComplete();
    }
  }
});

Ti.App.joli.models.initialize();
module.exports = Response;

