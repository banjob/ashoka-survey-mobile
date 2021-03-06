var _ = require('lib/underscore')._;
var Question = require('models/question');
var Response = require('models/response');
var Category = require('models/category');
var Option = require('models/option');
var progressBarView = require('ui/common/components/ProgressBar');
var SyncHandler = require('models/syncHandler');
var NetworkHelper = require('helpers/NetworkHelper');

var Survey = new Ti.App.joli.model({
  table : 'surveys',
  columns : {
    id : 'INTEGER PRIMARY KEY',
    name : 'TEXT',
    description : 'TEXT',
    expiry_date : 'TEXT',
    published_on : 'TEXT'
  },

  methods : {
    fetchSurveys : function(externalSyncHandler) {
      var that = this;

      var activityIndicator = Ti.UI.Android.createProgressIndicator({
        message : 'Saving your surveys on this device. Please wait.',
        location : Ti.UI.Android.PROGRESS_INDICATOR_DIALOG,
        type : Ti.UI.Android.PROGRESS_INDICATOR_INDETERMINANT
      });

      NetworkHelper.pingSurveyWebWithLoggedInCheck( onSuccess = function() {
        var url = Ti.App.Properties.getString('server_url') + '/api/deep_surveys';
        var client = Ti.Network.createHTTPClient({
          onload : function(e) {
            activityIndicator.show();
            var data = JSON.parse(this.responseText);
            that.truncate();
            Question.truncate();
            Category.truncate();
            Option.truncate();
            _(data).each(function(surveyData) {
              var survey = that.createRecord(surveyData);
              Question.createRecords(surveyData.questions, externalSyncHandler);
              Category.createRecords(surveyData.categories, externalSyncHandler);
            });
            externalSyncHandler.notifySyncComplete();
            activityIndicator.hide();
          },
          onerror : function(e) {
            Ti.API.debug(e.error);
            externalSyncHandler.notifySyncError({
              status : this.status
            });
          },
          ondatastream : function(e) {
            Ti.API.info('On Data Stream: ' + e.progress);
            externalSyncHandler.notifySyncProgress(e.progress);            
          }
        });
        client.setTimeout(30000);
        client.open("GET", url);
        client.send({
          access_token : Ti.App.Properties.getString('access_token'),
          extra_surveys : that.idsForExpiredSurveysWithResponses()
        });
      });
    },

    createRecord : function(surveyData) {
      var record = this.newRecord({
        id : surveyData.id,
        name : surveyData.name,
        description : surveyData.description,
        expiry_date : surveyData.expiry_date,
        published_on : parseInt(new Date(surveyData.published_on).getTime()/1000, 10)
      });
      record.save();
      return record;
    },

    isEmpty : function() {
      return this.count() === 0;
    },

    fetchAllQuestionsCount : function(callback) {
      NetworkHelper.pingSurveyWebWithLoggedInCheck( onSuccess = function() {
        var url = Ti.App.Properties.getString('server_url') + '/api/surveys/questions_count';
        var client = Ti.Network.createHTTPClient({
          onload : function() {
            var data = JSON.parse(this.responseText);
            Ti.API.info("There are " + data.count + " questions!");
            callback(data.count);
          },
          onerror : function(e) {
            Ti.API.debug("Questions count fetch failed");
            Ti.API.debug(e.error);
            Ti.App.fireEvent('surveys.fetch.error', {
              status : this.status
            });
          }
        });

        client.setTimeout(5000);
        client.open("GET", url);
        client.send({
          access_token : Ti.App.Properties.getString('access_token')
        });
      });
    },

    syncAllResponses : function(externalResponseSyncHandler) {
      var self = this;
      NetworkHelper.pingSurveyWebWithLoggedInCheck( onSuccess = function() {
        var surveyCount = _(self.all()).size();

        var syncCount = 0;
        var syncSummary = {'successes':0, 'errors':0};

        var generateAllResponsesSyncSummary = function(data) {
          syncCount++;
          data.has_error ? syncSummary['errors']++ : syncSummary['successes']++;
          if (syncCount === surveyCount) {
            externalResponseSyncHandler.notifySyncComplete(syncSummary);
          }
        };

        _(self.all()).each(function(survey) {
          survey.syncResponses(new SyncHandler(externalResponseSyncHandler.notifySyncProgress, generateAllResponsesSyncSummary), survey.id);
        });
      });
    },

    allResponsesCount : function() {
      return _(this.all()).reduce(function(total, survey){
        return total + survey.responseCount();
      }, 0);
    },

    idsForExpiredSurveysWithResponses : function() {
      return _.chain(this.all())
      .filter(function(survey){
        return survey.isExpired() && survey.responseCount() > 0;
      })
      .map(function(survey){
        return survey.id;
      })
      .value().join();
    },

    allSurveys : function() {
      return _(this.all()).sortBy(function(survey) {
        return survey.published_on;
      }).reverse();
    }
  },
  objectMethods : {
    syncResponses : function(externalResponseSyncHandler, surveyID) {
      Ti.App.fireEvent('responses.sync.start');

      var self = this;
      var responseSyncCount = 0;
      var syncSummary = {'successes':0, 'errors':0};
      var totalResponseCount =_(this.responses()).size();
      var responseStack = [];
      var syncNextResponse = function() {
        if (_.isEmpty(responseStack))
          return;
        responseStack.pop().syncRecords();
      };

      var syncHandler = function(data) {
        responseSyncCount++;

        data.has_error ? syncSummary['errors']++ : syncSummary['successes']++;
        if (self.allResponsesSynced(responseSyncCount, totalResponseCount)) {
          responseStack = [];
          Ti.App.removeEventListener("response:syncNextResponse" + surveyID, syncNextResponse);
          externalResponseSyncHandler.notifySyncComplete(syncSummary);
        }
        externalResponseSyncHandler.notifySyncProgress();
        Ti.App.removeEventListener("response.sync." + data.response_id, syncHandler);
      };

      _(this.responses()).each(function(response) {
        Ti.App.addEventListener("response.sync." + response.id, syncHandler);
        responseStack.push(response);
      });

      if(this.responseCount() > 0) {
      var initialResponse = responseStack.pop();
      initialResponse.syncRecords();
    }

      Ti.App.addEventListener("response:syncNextResponse"+ surveyID, syncNextResponse);
      if (totalResponseCount === 0) {
        Ti.API.info("No responses");
        externalResponseSyncHandler.notifySyncComplete({
          empty : true
        });
      }
    },

    responses : function() {
      this.response_objects = this.responsesForCurrentUser();
      return this.response_objects;
    },

    allResponsesSynced : function(successCount, total) {
      return total === successCount;
    },

    fetchCategories : function(externalSyncHandler) {
      Ti.API.info("In survey model fetchCategories Increment Sync handler is " + externalSyncHandler);
      var self = this;
      var url = Ti.App.Properties.getString('server_url') + '/api/categories?survey_id=' + self.id;
      var client = Ti.Network.createHTTPClient({
        onload : function(e) {
          Ti.API.info("Received text for categories: " + this.responseText);
          var data = JSON.parse(this.responseText);
          var records = Category.createRecords(data, self.id, null, externalSyncHandler);
        },
        onerror : function(e) {
          externalSyncHandler.notifySyncError({
            status : this.status
          });
          Ti.API.info("Error fetching categories.");
        },
        timeout : 5000 // in milliseconds
      });
      client.open("GET", url);
      client.send({
        access_token : Ti.App.Properties.getString('access_token')
      });
    },

    fetchQuestions : function(externalSyncHandler) {
      Ti.API.info("In survey model fetchQuestions Increment Sync handler is " + externalSyncHandler);
      var self = this;
      var url = Ti.App.Properties.getString('server_url') + '/api/questions?survey_id=' + self.id;
      var client = Ti.Network.createHTTPClient({
        onload : function(e) {
          Ti.API.info("Received text for questions: " + this.responseText);
          var data = JSON.parse(this.responseText);
          var records = Question.createRecords(data, self.id, null, externalSyncHandler);
        },
        onerror : function(e) {
          externalSyncHandler.notifySyncError({
            status : this.status
          });
          Ti.API.info("Error");
        },
        timeout : 5000 // in milliseconds
      });
      client.open("GET", url);
      client.send({
        access_token : Ti.App.Properties.getString('access_token')
      });
    },

    firstLevelQuestions : function() {
      var query = new Ti.App.joli.query().select('*').from('questions');
      query.where('survey_id = ?', this.id);
      query.where('parent_id IS NULL');
      query.where('category_id IS NULL');
      query.order('order_number');
      var sortedQuestionList = query.execute();
      return sortedQuestionList;
    },

    firstLevelCategories : function() {
      var query = new Ti.App.joli.query().select('*').from('categories');
      query.where('survey_id = ?', this.id);
      query.where('parent_id IS NULL');
      query.where('category_id IS NULL');
      query.order('order_number');
      var sortedCategoryList = query.execute();
      return sortedCategoryList;
    },

    firstLevelQuestionsAndCategories : function() {
      var elements = this.firstLevelQuestions().concat(this.firstLevelCategories());
      var sortedElements = _(elements).sortBy(function(element){ return element.order_number; });
      return sortedElements;
    },

    responseCount : function() {
      return _(this.responses()).size();
    },

    completeResponseCount : function() {
      var query = new Ti.App.joli.query().select('*').from('responses');
      query.where('survey_id = ?', this.id);
      query.where('user_id = ?', Ti.App.Properties.getString('user_id'));
      query.where('status = ?', 'complete');
      return _(query.execute()).size();
    },

    incompleteResponseCount : function() {
      var query = new Ti.App.joli.query().select('*').from('responses');
      query.where('survey_id = ?', this.id);
      query.where('user_id = ?', Ti.App.Properties.getString('user_id'));
      query.where('status != ?', 'complete');
      return _(query.execute()).size();
    },

    responsesForCurrentUser : function() {
      var query = new Ti.App.joli.query().select('*').from('responses');
      query.where('survey_id = ?', this.id);
      query.where('user_id = ?', Ti.App.Properties.getString('user_id'));
      return query.execute();
    },

    isExpired : function() {
      return new Date(this.expiry_date) < new Date();
    },

    questions : function() {
      return Question.findBy('survey_id', this.id);
    }
  }
});

Ti.App.joli.models.initialize();
module.exports = Survey;

